import { useEffect, useMemo, useState } from "react";
import { Plus, ShieldCheck, Check } from "lucide-react";
import { api, ApiRequestError } from "./api";
import { usePermission } from "./permissions";
import type { Permission, PermissionAction, PermissionModule, Role } from "./types";

const MODULE_LABELS: Record<PermissionModule, string> = {
  dashboard: "Painel",
  companies: "Empresas",
  branches: "Filiais",
  users: "Usuários",
  roles: "Perfis e permissões",
  products: "Produtos",
  stock: "Estoque",
  purchases: "Compras",
  sales: "Vendas",
  customers: "Clientes",
  suppliers: "Fornecedores",
  financial: "Financeiro",
  fiscal: "Fiscal",
  reports: "Relatórios",
  settings: "Configurações",
  audit: "Auditoria",
};

const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "Ver",
  create: "Criar",
  edit: "Editar",
  delete: "Excluir",
  cancel: "Cancelar",
  approve: "Aprovar",
  export: "Exportar",
  print: "Imprimir",
  change_prices: "Alterar preços",
  change_stock: "Alterar estoque",
  view_financial: "Ver financeiro",
  view_reports: "Ver relatórios",
  manage_users: "Gerenciar usuários",
};

export default function Roles() {
  const { can } = usePermission();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [rolePermissionIds, setRolePermissionIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        api.get<Role[]>("/roles"),
        api.get<Permission[]>("/roles", { action: "permissions" } as never),
      ]);
      setRoles(rolesRes);
      setPermissions(permsRes as unknown as Permission[]);
      if (!selectedRole && rolesRes.length > 0) {
        selectRole(rolesRes[0]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectRole(role: Role) {
    setSelectedRole(role);
    const ids = await api.get<string[]>("/roles", { action: "role-permissions", roleId: role.id } as never);
    setRolePermissionIds(new Set(ids as unknown as string[]));
  }

  const permissionsByModule = useMemo(() => {
    const map = new Map<PermissionModule, Permission[]>();
    for (const p of permissions) {
      if (!map.has(p.module)) map.set(p.module, []);
      map.get(p.module)!.push(p);
    }
    return map;
  }, [permissions]);

  function togglePermission(permissionId: string) {
    setRolePermissionIds((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) next.delete(permissionId);
      else next.add(permissionId);
      return next;
    });
  }

  async function savePermissions() {
    if (!selectedRole) return;
    setSaving(true);
    setError(null);
    try {
      await api.put("/roles", {
        action: "set-role-permissions",
        roleId: selectedRole.id,
        permissionIds: Array.from(rolePermissionIds),
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.payload.message : "Erro ao salvar permissões.");
    } finally {
      setSaving(false);
    }
  }

  async function createRole(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/roles", { name: newRoleName });
      setNewRoleName("");
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.payload.message : "Erro ao criar perfil.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink-800">Perfis e permissões</h1>
        <p className="mt-1 text-sm text-ink-400">
          Defina o que cada perfil de acesso pode ver e fazer em cada módulo do sistema.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        {/* Lista de perfis */}
        <div className="card p-2">
          <ul className="space-y-0.5">
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => selectRole(r)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                    selectedRole?.id === r.id ? "bg-ink-800 text-white" : "text-ink-600 hover:bg-ink-50"
                  }`}
                >
                  <ShieldCheck size={15} />
                  <span className="flex-1 truncate">{r.name}</span>
                  {r.isSystemRole && (
                    <span className="text-2xs uppercase tracking-wide opacity-60">Sistema</span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {can("roles", "create") && (
            <div className="mt-2 border-t border-ledger pt-2">
              {creating ? (
                <form onSubmit={createRole} className="space-y-2 px-1">
                  <input
                    autoFocus
                    className="input text-sm"
                    placeholder="Nome do novo perfil"
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button type="submit" disabled={saving} className="btn-primary flex-1 text-xs">
                      Criar
                    </button>
                    <button type="button" onClick={() => setCreating(false)} className="btn-ghost text-xs">
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <button onClick={() => setCreating(true)} className="btn-ghost w-full justify-start text-sm">
                  <Plus size={15} />
                  Novo perfil personalizado
                </button>
              )}
            </div>
          )}
        </div>

        {/* Matriz de permissões */}
        <div className="card p-5">
          {loading && <p className="text-sm text-ink-400">Carregando…</p>}

          {!loading && selectedRole && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-base font-semibold text-ink-800">{selectedRole.name}</h2>
                  {selectedRole.isSystemRole && (
                    <p className="text-2xs text-ink-400">Perfil padrão do sistema.</p>
                  )}
                </div>
                {can("roles", "edit") && (
                  <button onClick={savePermissions} disabled={saving} className="btn-primary">
                    {saving ? "Salvando…" : "Salvar permissões"}
                  </button>
                )}
              </div>

              {error && <p className="mb-3 text-sm text-danger">{error}</p>}

              <div className="space-y-4">
                {Array.from(permissionsByModule.entries()).map(([module, perms]) => (
                  <div key={module} className="rounded-lg border border-ledger">
                    <div className="border-b border-ledger bg-ink-50/60 px-3 py-2 text-sm font-medium text-ink-700">
                      {MODULE_LABELS[module]}
                    </div>
                    <div className="grid grid-cols-2 gap-1 p-3 sm:grid-cols-3 lg:grid-cols-4">
                      {perms.map((p) => {
                        const active = rolePermissionIds.has(p.id);
                        return (
                          <button
                            type="button"
                            key={p.id}
                            onClick={() => togglePermission(p.id)}
                            disabled={!can("roles", "edit")}
                            className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                              active
                                ? "bg-brass-50 text-brass-700"
                                : "text-ink-400 hover:bg-ink-50"
                            }`}
                          >
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                active ? "border-brass-400 bg-brass-400 text-white" : "border-ink-200"
                              }`}
                            >
                              {active && <Check size={11} />}
                            </span>
                            {ACTION_LABELS[p.action]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
