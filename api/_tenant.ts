import type { VercelRequest } from "@vercel/node";
import { query, queryOne } from "./_db";
import { readSessionToken, verifySessionToken } from "./_auth";
import { forbidden, unauthorized } from "./_http";
import type { PermissionAction, PermissionModule } from "../types";

// Resolve a sessão autenticada a partir do cookie httpOnly.
// O tenant_id NUNCA é aceito vindo do corpo/query da requisição (regra #49) —
// ele é sempre derivado daqui, a partir do usuário autenticado.

export interface ResolvedSession {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  roleIds: string[];
  roleKeys: string[];
  permissions: Set<string>; // "module:action"
  branchIds: string[];
  isSuperAdmin: boolean;
}

interface UserRow {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  status: string;
  locked_until: string | null;
}

interface TenantRow {
  id: string;
  subscription_status: string;
}

export async function resolveSession(req: VercelRequest): Promise<ResolvedSession> {
  const token = readSessionToken(req);
  if (!token) throw unauthorized();

  const payload = verifySessionToken(token);
  if (!payload) throw unauthorized();

  const user = await queryOne<UserRow>(
    `SELECT id, tenant_id, name, email, status, locked_until FROM users WHERE id = ? AND tenant_id = ?`,
    [payload.userId, payload.tenantId]
  );
  if (!user || user.status !== "active") throw unauthorized();
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw unauthorized("Usuário temporariamente bloqueado por excesso de tentativas de login.");
  }

  const tenant = await queryOne<TenantRow>(`SELECT id, subscription_status FROM tenants WHERE id = ?`, [
    user.tenant_id,
  ]);
  if (!tenant) throw unauthorized();
  if (tenant.subscription_status === "suspended" || tenant.subscription_status === "canceled") {
    throw forbidden("A assinatura desta conta está suspensa. Fale com o administrador da conta.");
  }

  const roleRows = await query<{ role_id: string; key: string }>(
    `SELECT ur.role_id as role_id, r.key as key
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?`,
    [user.id]
  );
  const roleIds = roleRows.map((r) => r.role_id);
  const roleKeys = roleRows.map((r) => r.key);
  const isSuperAdmin = roleKeys.includes("super_admin");

  const permissionRows = roleIds.length
    ? await query<{ module: string; action: string }>(
        `SELECT DISTINCT p.module as module, p.action as action
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id IN (${roleIds.map(() => "?").join(",")})`,
        roleIds
      )
    : [];
  const permissions = new Set(permissionRows.map((p) => `${p.module}:${p.action}`));

  const branchRows = await query<{ branch_id: string }>(
    `SELECT branch_id FROM user_branches WHERE user_id = ?`,
    [user.id]
  );

  return {
    userId: user.id,
    tenantId: user.tenant_id,
    email: user.email,
    name: user.name,
    roleIds,
    roleKeys,
    permissions,
    branchIds: branchRows.map((b) => b.branch_id),
    isSuperAdmin,
  };
}

export function requirePermission(
  session: ResolvedSession,
  module: PermissionModule,
  action: PermissionAction
): void {
  if (session.isSuperAdmin) return;
  if (!session.permissions.has(`${module}:${action}`)) throw forbidden();
}
