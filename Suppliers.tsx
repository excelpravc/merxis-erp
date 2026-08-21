import { useEffect, useState } from "react";
import { Plus, Search, Truck, Pencil } from "lucide-react";
import { api, ApiRequestError } from "./api";
import { usePermission } from "./permissions";
import type { Paginated, Supplier } from "./types";

export default function Suppliers() {
  const { can } = usePermission();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<Paginated<Supplier>>("/suppliers", { search, page: 1, pageSize: 50 });
      setSuppliers(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function toggleActive(s: Supplier) {
    await api.patch("/suppliers", { id: s.id, active: !s.active });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink-800">Fornecedores</h1>
          <p className="mt-1 text-sm text-ink-400">{total} fornecedor(es) cadastrado(s).</p>
        </div>
        {can("suppliers", "create") && (
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="btn-accent"
          >
            <Plus size={16} />
            Novo fornecedor
          </button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
        <input
          className="input pl-9"
          placeholder="Buscar por razão social, nome ou CNPJ…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-ledger bg-ink-50/60 text-left text-2xs font-semibold uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">Fornecedor</th>
              <th className="px-4 py-3">CNPJ</th>
              <th className="px-4 py-3">Contato</th>
              <th className="px-4 py-3">Condições</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ledger">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-400">
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && suppliers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-400">
                  Nenhum fornecedor encontrado. Cadastre o primeiro para liberar o módulo de compras.
                </td>
              </tr>
            )}
            {suppliers.map((s) => (
              <tr key={s.id} className="hover:bg-ink-50/40">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-50 text-ink-500">
                      <Truck size={15} />
                    </div>
                    <div>
                      <p className="font-medium text-ink-800">{s.tradeName || s.legalName}</p>
                      <p className="text-2xs text-ink-400">{s.legalName}</p>
                    </div>
                  </div>
                </td>
                <td className="tabular px-4 py-3 text-ink-600">{s.cnpj ? formatCnpj(s.cnpj) : "—"}</td>
                <td className="px-4 py-3 text-ink-600">
                  <p>{s.phone || "—"}</p>
                  <p className="text-2xs text-ink-400">{s.email || ""}</p>
                </td>
                <td className="px-4 py-3 text-ink-600">{s.paymentTerms || "—"}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => can("suppliers", "edit") && toggleActive(s)}
                    className={`badge ${s.active ? "bg-success/10 text-success" : "bg-ink-100 text-ink-400"}`}
                  >
                    {s.active ? "Ativo" : "Inativo"}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  {can("suppliers", "edit") && (
                    <button
                      onClick={() => {
                        setEditing(s);
                        setFormOpen(true);
                      }}
                      className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                      aria-label={`Editar ${s.legalName}`}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <SupplierFormModal
          supplier={editing}
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

function formatCnpj(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return cnpj;
  return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

function SupplierFormModal({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!supplier;
  const [form, setForm] = useState({
    legalName: supplier?.legalName ?? "",
    tradeName: supplier?.tradeName ?? "",
    cnpj: supplier?.cnpj ?? "",
    stateRegistration: supplier?.stateRegistration ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    city: supplier?.city ?? "",
    state: supplier?.state ?? "",
    paymentTerms: supplier?.paymentTerms ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await api.put("/suppliers", { id: supplier!.id, ...form });
      } else {
        await api.post("/suppliers", form);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.payload.message : "Erro ao salvar fornecedor.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="animate-fade-in max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl2 bg-surface p-6 shadow-popover">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink-800">
            {isEdit ? "Editar fornecedor" : "Novo fornecedor"}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-400 hover:bg-ink-50" aria-label="Fechar">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Razão social *</label>
              <input
                className="input"
                required
                value={form.legalName}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Nome fantasia</label>
              <input
                className="input"
                value={form.tradeName}
                onChange={(e) => setForm({ ...form, tradeName: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">CNPJ</label>
              <input
                className="input tabular"
                placeholder="00.000.000/0000-00"
                value={form.cnpj}
                onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Inscrição estadual</label>
              <input
                className="input"
                value={form.stateRegistration}
                onChange={(e) => setForm({ ...form, stateRegistration: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Telefone</label>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="label">E-mail</label>
              <input
                type="email"
                className="input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Cidade</label>
              <input
                className="input"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div>
              <label className="label">UF</label>
              <input
                className="input"
                maxLength={2}
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })}
              />
            </div>
          </div>

          <div>
            <label className="label">Condições de pagamento</label>
            <input
              className="input"
              placeholder="Ex: 30/60/90 dias, à vista com 2% desconto…"
              value={form.paymentTerms}
              onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Salvando…" : "Salvar fornecedor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
