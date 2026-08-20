import { useAuth } from "./auth";
import type { PermissionAction, PermissionModule, Session } from "./types";

/** Formata "module:action" — mesmo formato achatado que o backend envia na sessão. */
export function permissionKey(module: PermissionModule, action: PermissionAction): string {
  return `${module}:${action}`;
}

export function sessionHasPermission(
  session: Session | null,
  module: PermissionModule,
  action: PermissionAction
): boolean {
  if (!session) return false;
  if (session.isSuperAdmin) return true;
  return session.permissions.includes(permissionKey(module, action));
}

/** Hook de conveniência: `can("users", "manage_users")` dentro de componentes. */
export function usePermission() {
  const { session } = useAuth();
  return {
    can: (module: PermissionModule, action: PermissionAction) =>
      sessionHasPermission(session, module, action),
    isSuperAdmin: !!session?.isSuperAdmin,
    hasRole: (roleKey: string) => !!session?.roles.some((r) => r.key === roleKey),
  };
}
