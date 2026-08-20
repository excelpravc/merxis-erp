import { useEffect, useState } from "react";
import { Plus, Search, Users as UsersIcon, Lock, Unlock, Pencil } from "lucide-react";
import { api, ApiRequestError } from "./api";
import { usePermission } from "./permissions";
import type { Paginated, Role, User, UserStatus } from "./types";

const STATUS_LABEL: Record<UserStatus, string> = {
  active: "Ativo",
  inactive: "Inativo",
  blocked: "Bloqueado",
};

const STATUS_BADGE: Record<UserStatus, string> = {
  active: "bg-success/10 text-success",
  inactive: "bg-ink-100 text-ink-400",
  blocked: "bg-danger/10 text-danger",
};

export default function Users() {
  const { can } = usePermission();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        api.get<Paginated<User>>("/users", { search, page: 1, pageSize: 50 }),
        api.get<Role[]>("/roles"),
      ]);
      setUsers(usersRes.items);
      setTotal(usersRes.total);
      setRoles(rolesRes);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function toggleBlock(user: User) {
    const nextStatus: UserStatus = user.status === "blocked" ? "active" : "blocked";
    await api.patch("/users", { id: user.id, status: nextStatus });
    load();
  }

  function roleNames(user: User): string {
    return user.roleIds
      .map((id) => roles.find((r) => r.id === id)?.name)
      .filter(Boolean)
      .join(", ") || "—";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink-800">Usuários</h1>
          <p className="mt-1 text-sm text-ink-400">{total} usuário(s) na sua conta.</p>
        </div>
        {can("users", "create") && (
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="btn-accent"
          >
            <Plus size={16} />
            Novo usuário
          </button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
        <input
          className="input pl-9"
          placeholder="Buscar por nome ou e-mail…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-ledger bg-ink-50/60 text-left text-2xs font-semibold uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">Perfis</th>
              <th className="px-4 py-3">Último acesso</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ledger">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-400">
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-400">
                  Nenhum usuário encontrado.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-ink-50/40">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-2xs font-semibold text-ink-600">
                      <UsersIcon size={14} />
                    </div>
                    <div>
                      <p className="font-medium text-ink-800">{u.name}</p>
                      <p className="text-2xs text-ink-400">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-ink-600">{roleNames(u)}</td>
                <td className="tabular px-4 py-3 text-ink-500">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("pt-BR") : "Nunca acessou"}
                </td>
                <td className="px-4 py-3">
                  <span className={`badge ${STATUS_BADGE[u.status]}`}>{STATUS_LABEL[u.status]}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {can("users", "edit") && (
                      <button
                        onClick={() => {
                          setEditing(u);
                          setFormOpen(true);
                        }}
                        className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                        aria-label={`Editar ${u.name}`}
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                    {can("users", "manage_users") && (
                      <button
                        onClick={() => toggleBlock(u)}
                        className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                        aria-label={u.status === "blocked" ? "Desbloquear" : "Bloquear"}
                      >
                        {u.status === "blocked" ? <Unlock size={15} /> : <Lock size={15} />}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <UserFormModal
          user={editing}
          roles={roles}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function UserFormModal({
  user,
  roles,
  onClose,
  onSaved,
}: {
  user: User | null;
  roles: Role[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!user;
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [roleIds, setRoleIds] = useState<string[]>(user?.roleIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRole(id: string) {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await api.put("/users", { id: user!.id, name, email, roleIds });
      } else {
        await api.post("/users", { name, email, roleIds });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.payload.message : "Erro ao salvar usuário.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="animate-fade-in w-full max-w-md rounded-xl2 bg-surface p-6 shadow-popover">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink-800">
            {isEdit ? "Editar usuário" : "Novo usuário"}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-400 hover:bg-ink-50" aria-label="Fechar">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Nome completo</label>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">E-mail</label>
            <input
              type="email"
              className="input"
              required
              disabled={isEdit}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {!isEdit && (
              <p className="mt-1 text-2xs text-ink-400">
                Um convite com senha provisória será enviado para este e-mail.
              </p>
            )}
          </div>

          <div>
            <label className="label">Perfis de acesso</label>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-ledger p-2">
              {roles.map((r) => (
                <label key={r.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-ink-50">
                  <input
                    type="checkbox"
                    checked={roleIds.includes(r.id)}
                    onChange={() => toggleRole(r.id)}
                  />
                  {r.name}
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Salvando…" : isEdit ? "Salvar alterações" : "Convidar usuário"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
