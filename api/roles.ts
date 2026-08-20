import type { VercelRequest, VercelResponse } from "@vercel/node";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { query, queryOne, exec } from "./_db";
import { resolveSession, requirePermission, type ResolvedSession } from "./_tenant";
import { badRequest, conflict, forbidden, notFound, sendError, sendJson } from "./_http";
import { recordAudit } from "./_audit";
import type { Permission, Role } from "../types";

// GET /api/roles                                    -> perfis visíveis ao tenant (sistema + personalizados)
// GET /api/roles?action=permissions                 -> catálogo completo de permissões (module x action)
// GET /api/roles?action=role-permissions&roleId=     -> IDs de permissão atribuídos a um perfil
// POST /api/roles { name, description? }             -> cria perfil personalizado do tenant
// PUT /api/roles { action: "set-role-permissions", roleId, permissionIds } -> substitui as permissões do perfil
//
// Perfis de sistema (tenant_id NULL) são modelos compartilhados por toda a
// plataforma e não podem ser editados por um tenant específico — isso evitaria
// vazar mudanças de permissão entre contas diferentes. Para customizar, o
// tenant cria um perfil próprio (ver createRole).

const createRoleSchema = z.object({
  name: z.string().min(2, "Informe o nome do perfil."),
  description: z.string().optional().default(""),
});

const setPermissionsSchema = z.object({
  roleId: z.string(),
  permissionIds: z.array(z.string()),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await resolveSession(req);

    if (req.method === "GET") {
      const action = String(req.query.action ?? "");
      requirePermission(session, "roles", "view");
      if (action === "permissions") return await listPermissions(res);
      if (action === "role-permissions") return await listRolePermissionIds(req, res, session);
      return await listRoles(res, session.tenantId);
    }

    if (req.method === "POST") {
      requirePermission(session, "roles", "create");
      return await createRole(req, res, session);
    }

    if (req.method === "PUT") {
      const action = String(req.body?.action ?? "");
      if (action === "set-role-permissions") {
        requirePermission(session, "roles", "edit");
        return await setRolePermissions(req, res, session);
      }
      throw badRequest("Ação inválida.");
    }

    throw badRequest("Método não suportado.");
  } catch (err) {
    sendError(res, err);
  }
}

function mapRoleRow(row: Record<string, unknown>): Role {
  return {
    id: row.id as string,
    tenantId: (row.tenant_id as string) ?? null,
    key: row.key as Role["key"],
    name: row.name as string,
    description: (row.description as string) ?? null,
    isSystemRole: Boolean(row.is_system_role),
    createdAt: row.created_at as string,
  };
}

async function listRoles(res: VercelResponse, tenantId: string) {
  const rows = await query(
    `SELECT * FROM roles WHERE tenant_id IS NULL OR tenant_id = ? ORDER BY is_system_role DESC, name ASC`,
    [tenantId]
  );
  const payload: Role[] = rows.map(mapRoleRow);
  sendJson(res, 200, payload);
}

async function listPermissions(res: VercelResponse) {
  const rows = await query(`SELECT * FROM permissions ORDER BY module ASC, action ASC`);
  const payload: Permission[] = rows.map((r) => ({
    id: r.id as string,
    module: r.module as Permission["module"],
    action: r.action as Permission["action"],
  }));
  sendJson(res, 200, payload);
}

async function listRolePermissionIds(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const roleId = String(req.query.roleId ?? "");
  if (!roleId) throw badRequest("Informe o perfil.");

  const role = await queryOne(`SELECT id FROM roles WHERE id = ? AND (tenant_id IS NULL OR tenant_id = ?)`, [
    roleId,
    session.tenantId,
  ]);
  if (!role) throw notFound("Perfil não encontrado.");

  const rows = await query<{ permission_id: string }>(
    `SELECT DISTINCT permission_id FROM role_permissions WHERE role_id = ?`,
    [roleId]
  );
  sendJson(res, 200, rows.map((r) => r.permission_id));
}

async function createRole(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const parsed = createRoleSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const data = parsed.data;

  const key = data.name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  const existing = await queryOne(`SELECT id FROM roles WHERE tenant_id = ? AND key = ?`, [
    session.tenantId,
    key || "personalizado",
  ]);
  if (existing) throw conflict("Já existe um perfil com este nome.");

  const id = uuid();
  await exec(
    `INSERT INTO roles (id, tenant_id, key, name, description, is_system_role) VALUES (?, ?, ?, ?, ?, 0)`,
    [id, session.tenantId, key || `custom_${id.slice(0, 8)}`, data.name, data.description || null]
  );

  await recordAudit(session, {
    module: "roles",
    action: "create",
    recordId: id,
    description: `Perfil personalizado "${data.name}" criado.`,
  });

  const row = await queryOne(`SELECT * FROM roles WHERE id = ?`, [id]);
  sendJson(res, 201, mapRoleRow(row!));
}

async function setRolePermissions(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const parsed = setPermissionsSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const { roleId, permissionIds } = parsed.data;

  const role = await queryOne<{ id: string; tenant_id: string | null; name: string; is_system_role: number }>(
    `SELECT id, tenant_id, name, is_system_role FROM roles WHERE id = ?`,
    [roleId]
  );
  if (!role) throw notFound("Perfil não encontrado.");
  if (role.tenant_id === null) {
    throw forbidden(
      "Perfis de sistema não podem ser editados diretamente. Crie um perfil personalizado para customizar permissões."
    );
  }
  if (role.tenant_id !== session.tenantId) throw notFound("Perfil não encontrado.");

  if (permissionIds.length > 0) {
    const placeholders = permissionIds.map(() => "?").join(",");
    const validPermissions = await query<{ id: string }>(
      `SELECT id FROM permissions WHERE id IN (${placeholders})`,
      permissionIds
    );
    if (validPermissions.length !== permissionIds.length) throw badRequest("Uma ou mais permissões são inválidas.");
  }

  await exec(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);
  for (const permissionId of permissionIds) {
    await exec(`INSERT INTO role_permissions (role_id, permission_id, branch_id) VALUES (?, ?, NULL)`, [
      roleId,
      permissionId,
    ]);
  }

  await recordAudit(session, {
    module: "roles",
    action: "edit",
    recordId: roleId,
    description: `Permissões do perfil "${role.name}" atualizadas (${permissionIds.length} permissão(ões)).`,
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
