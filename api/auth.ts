import type { VercelRequest, VercelResponse } from "@vercel/node";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { query, queryOne, exec } from "./_db";
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from "./_auth";
import { resolveSession } from "./_tenant";
import { badRequest, sendError, sendJson, unauthorized, forbidden } from "./_http";
import { recordAudit } from "./_audit";
import type { Session } from "../types";

// POST /api/auth  { action: "login" | "logout" | "register" }
// GET  /api/auth?action=session
//
// Um único arquivo cobre as ações de autenticação — mantendo /api sem
// subpastas, conforme a regra estrutural do projeto.

const MAX_LOGIN_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5);
const LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES ?? 15);

const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});

const registerSchema = z.object({
  tenantName: z.string().min(2, "Informe o nome da empresa/conta."),
  adminName: z.string().min(2, "Informe seu nome completo."),
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres."),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const action = String(req.query.action ?? "");
      if (action === "session") return await handleSession(req, res);
      throw badRequest("Ação inválida.");
    }

    if (req.method === "POST") {
      const action = String(req.body?.action ?? "");
      if (action === "login") return await handleLogin(req, res);
      if (action === "logout") return await handleLogout(req, res);
      if (action === "register") return await handleRegister(req, res);
      throw badRequest("Ação inválida.");
    }

    throw badRequest("Método não suportado.");
  } catch (err) {
    sendError(res, err);
  }
}

interface UserAuthRow {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  password_hash: string;
  status: string;
  failed_login_attempts: number;
  locked_until: string | null;
}

async function handleLogin(req: VercelRequest, res: VercelResponse) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const { email, password } = parsed.data;

  const user = await queryOne<UserAuthRow>(
    `SELECT id, tenant_id, name, email, password_hash, status, failed_login_attempts, locked_until
     FROM users WHERE email = ?`,
    [email.toLowerCase().trim()]
  );

  // Mensagem genérica propositalmente — não revelar se o e-mail existe ou não.
  const genericError = () => unauthorized("E-mail ou senha incorretos.");

  if (!user) throw genericError();

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw unauthorized(
      `Conta temporariamente bloqueada por excesso de tentativas. Tente novamente após ${new Date(
        user.locked_until
      ).toLocaleTimeString("pt-BR")}.`
    );
  }

  if (user.status === "blocked") throw forbidden("Sua conta está bloqueada. Contate o administrador.");
  if (user.status === "inactive") throw forbidden("Sua conta está inativa. Contate o administrador.");

  const validPassword = await verifyPassword(password, user.password_hash);

  if (!validPassword) {
    const attempts = user.failed_login_attempts + 1;
    const lockedUntil =
      attempts >= MAX_LOGIN_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
        : null;
    await exec(`UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?`, [
      attempts,
      lockedUntil,
      user.id,
    ]);
    if (lockedUntil) {
      throw unauthorized(
        `E-mail ou senha incorretos. Conta bloqueada por ${LOCKOUT_MINUTES} minutos após ${MAX_LOGIN_ATTEMPTS} tentativas.`
      );
    }
    throw genericError();
  }

  // Login válido: zera tentativas, registra último acesso, emite sessão.
  await exec(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?`,
    [user.id]
  );

  const token = signSessionToken({ userId: user.id, tenantId: user.tenant_id });
  setSessionCookie(res, token);

  await recordAudit(
    {
      userId: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      name: user.name,
      roleIds: [],
      roleKeys: [],
      permissions: new Set(),
      branchIds: [],
      isSuperAdmin: false,
    },
    { module: "auth", action: "login", description: `Usuário ${user.name} entrou no sistema.` }
  );

  sendJson(res, 200, { ok: true });
}

async function handleLogout(req: VercelRequest, res: VercelResponse) {
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}

async function handleSession(req: VercelRequest, res: VercelResponse) {
  const session = await resolveSession(req);

  const [userRow, tenantRow, roleRows] = await Promise.all([
    queryOne<{ id: string; tenant_id: string; name: string; email: string; status: string }>(
      `SELECT id, tenant_id, name, email, status FROM users WHERE id = ?`,
      [session.userId]
    ),
    queryOne<{ id: string; name: string; subscription_status: string }>(
      `SELECT id, name, subscription_status FROM tenants WHERE id = ?`,
      [session.tenantId]
    ),
    query<{ id: string; key: string; name: string }>(
      `SELECT r.id as id, r.key as key, r.name as name
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
      [session.userId]
    ),
  ]);

  if (!userRow || !tenantRow) throw unauthorized();

  const payload: Session = {
    user: {
      id: userRow.id,
      tenantId: userRow.tenant_id,
      name: userRow.name,
      email: userRow.email,
      status: userRow.status as Session["user"]["status"],
    },
    tenant: {
      id: tenantRow.id,
      name: tenantRow.name,
      subscriptionStatus: tenantRow.subscription_status as Session["tenant"]["subscriptionStatus"],
    },
    roles: roleRows.map((r) => ({ id: r.id, name: r.name, key: r.key as Session["roles"][number]["key"] })),
    permissions: Array.from(session.permissions),
    branchIds: session.branchIds,
    isSuperAdmin: session.isSuperAdmin,
  };

  sendJson(res, 200, payload);
}

async function handleRegister(req: VercelRequest, res: VercelResponse) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const { tenantName, adminName, email, password } = parsed.data;

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await queryOne(`SELECT id FROM users WHERE email = ?`, [normalizedEmail]);
  if (existing) throw badRequest("Este e-mail já está em uso.", { email: "E-mail já cadastrado." });

  const basicPlan = await queryOne<{ id: string }>(`SELECT id FROM plans WHERE key = 'basico'`);
  const companyAdminRole = await queryOne<{ id: string }>(
    `SELECT id FROM roles WHERE key = 'company_admin' AND tenant_id IS NULL`
  );
  if (!companyAdminRole) {
    throw badRequest(
      "O sistema ainda não foi inicializado (perfis padrão ausentes). Execute `npm run seed` primeiro."
    );
  }

  const tenantId = uuid();
  const userId = uuid();
  const passwordHash = await hashPassword(password);

  await exec(
    `INSERT INTO tenants (id, name, plan_id, subscription_status, trial_ends_at)
     VALUES (?, ?, ?, 'trial', datetime('now', '+14 days'))`,
    [tenantId, tenantName, basicPlan?.id ?? null]
  );
  await exec(
    `INSERT INTO users (id, tenant_id, name, email, password_hash, status) VALUES (?, ?, ?, ?, ?, 'active')`,
    [userId, tenantId, adminName, normalizedEmail, passwordHash]
  );
  await exec(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [userId, companyAdminRole.id]);

  const token = signSessionToken({ userId, tenantId });
  setSessionCookie(res, token);

  sendJson(res, 201, { ok: true });
}

function flattenZod(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fields[key] = issue.message;
  }
  return fields;
}
