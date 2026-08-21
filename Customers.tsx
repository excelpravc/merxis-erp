import { useEffect, useState } from "react";
import { Plus, Search, UserRound, Pencil } from "lucide-react";
import { api, ApiRequestError } from "./api";
import { usePermission } from "./permissions";
import type { Customer, Paginated } from "./types";

export default function Customers() {
  const { can } = usePermission();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<Paginated<Customer>>("/customers", { search, page: 1, pageSize: 50 });
      setCustomers(res.items);
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

  async function toggleActive(c: Customer) {
    await api.patch("/customers", { id: c.id, active: !c.active });
    load();
  }

  function currency(value: number) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatDocument(doc: string): string {
    const digits = doc.replace(/\D/g, "");
    if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    return doc;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink-800">Clientes</h1>
          <p className="mt-1 text-sm text-ink-400">{total} cliente(s) cadastrado(s).</p>
        </div>
        {can("customers", "create") && (
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="btn-accent"
          >
            <Plus size={16} />
            Novo cliente
          </button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
        <input
          className="input pl-9"
          placeholder="Buscar por nome, CPF/CNPJ ou telefone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-ledger bg-ink-50/60 text-left text-2xs font-semibold uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">CPF/CNPJ</th>
              <th className="px-4 py-3">Contato</th>
              <th className="px-4 py-3">Limite de crédito</th>
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
            {!loading && customers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-400">
                  Nenhum cliente encontrado. Cadastre o primeiro para começar a vender.
                </td>
              </tr>
            )}
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-ink-50/40">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-50 text-ink-500">
                      <UserRound size={15} />
                    </div>
                    <p className="font-medium text-ink-800">{c.name}</p>
                  </div>
                </td>
                <td className="tabular px-4 py-3 text-ink-600">{c.document ? formatDocument(c.document) : "—"}</td>
                <td className="px-4 py-3 text-ink-600">
                  <p>{c.phone || "—"}</p>
                  <p className="text-2xs text-ink-400">{c.email || ""}</p>
                </td>
                <td className="tabular px-4 py-3 text-ink-600">{currency(c.creditLimit)}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => can("customers", "edit") && toggleActive(c)}
                    className={`badge ${c.active ? "bg-success/10 text-success" : "bg-ink-100 text-ink-400"}`}
                  >
                    {c.active ? "Ativo" : "Inativo"}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  {can("customers", "edit") && (
                    <button
                      onClick={() => {
                        setEditing(c);
                        setFormOpen(true);
                      }}
                      className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                      aria-label={`Editar ${c.name}`}
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
        <CustomerFormModal
          customer={editing}
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

function CustomerFormModal({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!customer;
  const [form, setForm] = useState({
    name: customer?.name ?? "",
    document: customer?.document ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    city: customer?.city ?? "",
    state: customer?.state ?? "",
    creditLimit: customer?.creditLimit ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await api.put("/customers", { id: customer!.id, ...form });
      } else {
        await api.post("/customers", form);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.payload.message : "Erro ao salvar cliente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="animate-fade-in max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl2 bg-surface p-6 shadow-popover">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink-800">
            {isEdit ? "Editar cliente" : "Novo cliente"}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-400 hover:bg-ink-50" aria-label="Fechar">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Nome completo / Razão social *</label>
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">CPF/CNPJ</label>
              <input
                className="input tabular"
                disabled={isEdit}
                value={form.document}
                onChange={(e) => setForm({ ...form, document: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Telefone</label>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
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
            <label className="label">Limite de crédito</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input tabular"
              value={form.creditLimit}
              onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) })}
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Salvando…" : "Salvar cliente"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
