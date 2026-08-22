import type { VercelRequest, VercelResponse } from "@vercel/node";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { query, queryOne, exec } from "./_db.js";
import { hashPassword } from "./_auth.js";
import { resolveSession, requirePermission, type ResolvedSession } from "./_tenant.js";
import { badRequest, conflict, notFound, sendError, sendJson } from "./_http.js";
import { recordAudit } from "./_audit.js";
import type { Paginated, User } from "../types.js";

// GET   /api/users?search=&page=&pageSize=   -> lista usuários do tenant
// POST  /api/users                           -> cria usuário (+ perfis)
// PUT   /api/users { id, name, roleIds }     -> edita nome e perfis
// PATCH /api/users { id, status }            -> ativa/inativa/bloqueia
//
// tenant_id sempre vem da sessão — nunca do corpo da requisição.

const createSchema = z.object({
  name: z.string().min(2, "Informe o nome completo."),
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres.").optional().or(z.literal("")),
  roleIds: z.array(z.string()).optional().default([]),
});

const updateSchema = z.object({
  id: z.string(),
  name: z.string().min(2).optional(),
  roleIds: z.array(z.string()).optional(),
});

const statusSchema = z.object({
  id: z.string(),
  status: z.enum(["active", "inactive", "blocked"]),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await resolveSession(req);

    if (req.method === "GET") {
      requirePermission(session, "users", "view");
      return await listUsers(req, res, session.tenantId);
    }

    if (req.method === "POST") {
      requirePermission(session, "users", "create");
      return await createUser(req, res, session);
    }

    if (req.method === "PUT") {
      requirePermission(session, "users", "edit");
      return await updateUser(req, res, session);
    }

    if (req.method === "PATCH") {
      requirePermission(session, "users", "manage_users");
      return await updateStatus(req, res, session);
    }

    throw badRequest("Método não suportado.");
  } catch (err) {
    sendError(res, err);
  }
}

interface UserRow {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  status: string;
  last_login_at: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  created_at: string;
}

async function attachRolesAndBranches(rows: UserRow[]): Promise<User[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");

  const roleRows = await query<{ user_id: string; role_id: string }>(
    `SELECT user_id, role_id FROM user_roles WHERE user_id IN (${placeholders})`,
    ids
  );
  const branchRows = await query<{ user_id: string; branch_id: string }>(
    `SELECT user_id, branch_id FROM user_branches WHERE user_id IN (${placeholders})`,
    ids
  );

  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows) rolesByUser.set(r.user_id, [...(rolesByUser.get(r.user_id) ?? []), r.role_id]);
  const branchesByUser = new Map<string, string[]>();
  for (const b of branchRows)
    branchesByUser.set(b.user_id, [...(branchesByUser.get(b.user_id) ?? []), b.branch_id]);

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    email: row.email,
    status: row.status as User["status"],
    roleIds: rolesByUser.get(row.id) ?? [],
    branchIds: branchesByUser.get(row.id) ?? [],
    lastLoginAt: row.last_login_at,
    failedLoginAttempts: row.failed_login_attempts,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
  }));
}

async function listUsers(req: VercelRequest, res: VercelResponse, tenantId: string) {
  const search = String(req.query.search ?? "").trim();
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
  const offset = (page - 1) * pageSize;

  const searchClause = search ? `AND (name LIKE ? OR email LIKE ?)` : "";
  const searchArgs = search ? [`%${search}%`, `%${search}%`] : [];

  const rows = await query<UserRow>(
    `SELECT id, tenant_id, name, email, status, last_login_at, failed_login_attempts, locked_until, created_at
     FROM users WHERE tenant_id = ? ${searchClause} ORDER BY name ASC LIMIT ? OFFSET ?`,
    [tenantId, ...searchArgs, pageSize, offset]
  );
  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*) as total FROM users WHERE tenant_id = ? ${searchClause}`,
    [tenantId, ...searchArgs]
  );

  const payload: Paginated<User> = {
    items: await attachRolesAndBranches(rows),
    total: countRow?.total ?? 0,
    page,
    pageSize,
  };
  sendJson(res, 200, payload);
}

async function createUser(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const data = parsed.data;
  const email = data.email.toLowerCase().trim();

  const existing = await queryOne(`SELECT id FROM users WHERE tenant_id = ? AND email = ?`, [
    session.tenantId,
    email,
  ]);
  if (existing) throw conflict("Já existe um usuário com este e-mail nesta conta.");

  // Perfis customizados do tenant OU perfis globais de sistema podem ser atribuídos.
  if (data.roleIds.length > 0) {
    const placeholders = data.roleIds.map(() => "?").join(",");
    const validRoles = await query<{ id: string }>(
      `SELECT id FROM roles WHERE id IN (${placeholders}) AND (tenant_id = ? OR tenant_id IS NULL)`,
      [...data.roleIds, session.tenantId]
    );
    if (validRoles.length !== data.roleIds.length) throw badRequest("Um ou mais perfis selecionados são inválidos.");
  }

  const id = uuid();
  const rawPassword = (data.password && data.password.length >= 8) ? data.password : uuid();
  const passwordHash = await hashPassword(rawPassword);

  await exec(
    `INSERT INTO users (id, tenant_id, name, email, password_hash, status) VALUES (?, ?, ?, ?, ?, 'active')`,
    [id, session.tenantId, data.name, email, passwordHash]
  );

  for (const roleId of data.roleIds) {
    await exec(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [id, roleId]);
  }

  await recordAudit(session, {
    module: "users",
    action: "create",
    recordId: id,
    description: `Usuário "${data.name}" (${email}) cadastrado.`,
  });

  const row = await queryOne<UserRow>(
    `SELECT id, tenant_id, name, email, status, last_login_at, failed_login_attempts, locked_until, created_at FROM users WHERE id = ?`,
    [id]
  );
  const [user] = await attachRolesAndBranches([row!]);
  sendJson(res, 201, user);
}

async function updateUser(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const data = parsed.data;

  const current = await queryOne<{ name: string }>(`SELECT name FROM users WHERE id = ? AND tenant_id = ?`, [
    data.id,
    session.tenantId,
  ]);
  if (!current) throw notFound("Usuário não encontrado.");

  if (data.name) {
    await exec(`UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`, [
      data.name,
      data.id,
      session.tenantId,
    ]);
  }

  if (data.roleIds) {
    const placeholders = data.roleIds.map(() => "?").join(",");
    if (data.roleIds.length > 0) {
      const validRoles = await query<{ id: string }>(
        `SELECT id FROM roles WHERE id IN (${placeholders}) AND (tenant_id = ? OR tenant_id IS NULL)`,
        [...data.roleIds, session.tenantId]
      );
      if (validRoles.length !== data.roleIds.length)
        throw badRequest("Um ou mais perfis selecionados são inválidos.");
    }
    await exec(`DELETE FROM user_roles WHERE user_id = ?`, [data.id]);
    for (const roleId of data.roleIds) {
      await exec(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [data.id, roleId]);
    }
  }

  await recordAudit(session, {
    module: "users",
    action: "edit",
    recordId: data.id,
    description: `Usuário "${current.name}" atualizado.`,
  });

  const row = await queryOne<UserRow>(
    `SELECT id, tenant_id, name, email, status, last_login_at, failed_login_attempts, locked_until, created_at FROM users WHERE id = ?`,
    [data.id]
  );
  const [user] = await attachRolesAndBranches([row!]);
  sendJson(res, 200, user);
}

async function updateStatus(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const { id, status } = parsed.data;

  if (id === session.userId && status !== "active") {
    throw badRequest("Você não pode bloquear ou inativar o próprio usuário.");
  }

  const current = await queryOne<{ name: string }>(`SELECT name FROM users WHERE id = ? AND tenant_id = ?`, [
    id,
    session.tenantId,
  ]);
  if (!current) throw notFound("Usuário não encontrado.");

  const clearsLock = status === "active";
  await exec(
    `UPDATE users SET status = ?, updated_at = datetime('now')${clearsLock ? ", locked_until = NULL, failed_login_attempts = 0" : ""}
     WHERE id = ? AND tenant_id = ?`,
    [status, id, session.tenantId]
  );

  await recordAudit(session, {
    module: "users",
    action: status === "blocked" ? "block" : status === "active" ? "unblock" : "deactivate",
    recordId: id,
    description: `Status do usuário "${current.name}" alterado para "${status}".`,
  });

  sendJson(res, 200, { ok: true });
}

function flattenZod(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fields[key] = issue.message;
  }
  return fields;
}
