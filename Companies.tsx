import { useEffect, useState } from "react";
import { Plus, Search, Building2, ChevronRight, Pencil, MapPin } from "lucide-react";
import { api, ApiRequestError } from "./api";
import { usePermission } from "./permissions";
import type { Branch, Company, Paginated, TaxRegime } from "./types";

const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  simples_nacional: "Simples Nacional",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
  mei: "MEI",
};

export default function Companies() {
  const { can } = usePermission();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Company | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<Paginated<Company>>("/companies", { search, page: 1, pageSize: 50 });
      setCompanies(res.items);
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

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(c: Company) {
    setEditing(c);
    setFormOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink-800">Empresas e filiais</h1>
          <p className="mt-1 text-sm text-ink-400">{total} empresa(s) cadastrada(s).</p>
        </div>
        {can("companies", "create") && (
          <button onClick={openCreate} className="btn-accent">
            <Plus size={16} />
            Nova empresa
          </button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
        <input
          className="input pl-9"
          placeholder="Buscar por razão social ou CNPJ…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-ledger bg-ink-50/60 text-left text-2xs font-semibold uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">Empresa</th>
              <th className="px-4 py-3">CNPJ</th>
              <th className="px-4 py-3">Regime tributário</th>
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
            {!loading && companies.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-400">
                  Nenhuma empresa encontrada. Cadastre a primeira empresa para começar.
                </td>
              </tr>
            )}
            {companies.map((c) => (
              <tr
                key={c.id}
                className="cursor-pointer hover:bg-ink-50/40"
                onClick={() => setSelected(c)}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-50 text-ink-500">
                      <Building2 size={15} />
                    </div>
                    <div>
                      <p className="font-medium text-ink-800">{c.tradeName || c.legalName}</p>
                      <p className="text-2xs text-ink-400">{c.legalName}</p>
                    </div>
                    {c.isMatrix && <span className="badge bg-brass-100 text-brass-700">Matriz</span>}
                  </div>
                </td>
                <td className="tabular px-4 py-3 text-ink-600">{formatCnpj(c.cnpj)}</td>
                <td className="px-4 py-3 text-ink-600">{TAX_REGIME_LABELS[c.taxRegime]}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${c.active ? "bg-success/10 text-success" : "bg-ink-100 text-ink-400"}`}>
                    {c.active ? "Ativa" : "Inativa"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {can("companies", "edit") && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(c);
                        }}
                        className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                        aria-label={`Editar ${c.tradeName}`}
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                    <ChevronRight size={16} className="text-ink-300" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <CompanyFormModal
          company={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            load();
          }}
        />
      )}

      {selected && (
        <BranchesPanel company={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function formatCnpj(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return cnpj;
  return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

// ---------------------------------------------------------------------------
// Formulário de empresa (criação/edição)
// ---------------------------------------------------------------------------

function CompanyFormModal({
  company,
  onClose,
  onSaved,
}: {
  company: Company | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!company;
  const [form, setForm] = useState({
    legalName: company?.legalName ?? "",
    tradeName: company?.tradeName ?? "",
    cnpj: company?.cnpj ?? "",
    stateRegistration: company?.stateRegistration ?? "",
    taxRegime: company?.taxRegime ?? ("simples_nacional" as TaxRegime),
    email: company?.email ?? "",
    phone: company?.phone ?? "",
    city: company?.city ?? "",
    state: company?.state ?? "",
    isMatrix: company?.isMatrix ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await api.put(`/companies`, { id: company!.id, ...form });
      } else {
        await api.post(`/companies`, form);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.payload.message : "Erro ao salvar empresa.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Editar empresa" : "Nova empresa"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Razão social" required>
            <input
              className="input"
              required
              value={form.legalName}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
            />
          </Field>
          <Field label="Nome fantasia">
            <input
              className="input"
              value={form.tradeName}
              onChange={(e) => setForm({ ...form, tradeName: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="CNPJ" required>
            <input
              className="input tabular"
              required
              placeholder="00.000.000/0000-00"
              value={form.cnpj}
              onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
            />
          </Field>
          <Field label="Inscrição estadual">
            <input
              className="input"
              value={form.stateRegistration}
              onChange={(e) => setForm({ ...form, stateRegistration: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Regime tributário" required>
          <select
            className="input"
            value={form.taxRegime}
            onChange={(e) => setForm({ ...form, taxRegime: e.target.value as TaxRegime })}
          >
            {Object.entries(TAX_REGIME_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="E-mail">
            <input
              type="email"
              className="input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Telefone">
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Cidade">
            <input
              className="input"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </Field>
          <Field label="UF">
            <input
              className="input"
              maxLength={2}
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input
            type="checkbox"
            checked={form.isMatrix}
            onChange={(e) => setForm({ ...form, isMatrix: e.target.checked })}
          />
          Esta é a empresa matriz
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Salvando…" : "Salvar empresa"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Painel de filiais de uma empresa
// ---------------------------------------------------------------------------

function BranchesPanel({ company, onClose }: { company: Company; onClose: () => void }) {
  const { can } = usePermission();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newBranch, setNewBranch] = useState({ name: "", code: "", city: "", state: "" });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<Paginated<Branch>>("/companies", {
        action: "branches",
        companyId: company.id,
      } as never);
      setBranches((res as unknown as { items: Branch[] }).items ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.id]);

  async function handleAddBranch(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/companies", { action: "create-branch", companyId: company.id, ...newBranch });
      setNewBranch({ name: "", code: "", city: "", state: "" });
      setAdding(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Filiais — ${company.tradeName || company.legalName}`} onClose={onClose} wide>
      <div className="space-y-4">
        {loading && <p className="text-sm text-ink-400">Carregando filiais…</p>}

        {!loading && branches.length === 0 && !adding && (
          <p className="text-sm text-ink-400">Nenhuma filial cadastrada além da matriz.</p>
        )}

        <ul className="space-y-2">
          {branches.map((b) => (
            <li key={b.id} className="flex items-center justify-between rounded-lg border border-ledger px-3 py-2">
              <div className="flex items-center gap-2">
                <MapPin size={15} className="text-ink-400" />
                <div>
                  <p className="text-sm font-medium text-ink-800">{b.name}</p>
                  <p className="text-2xs text-ink-400">
                    Código {b.code}
                    {b.city ? ` · ${b.city}/${b.state}` : ""}
                  </p>
                </div>
              </div>
              <span className={`badge ${b.active ? "bg-success/10 text-success" : "bg-ink-100 text-ink-400"}`}>
                {b.active ? "Ativa" : "Inativa"}
              </span>
            </li>
          ))}
        </ul>

        {adding ? (
          <form onSubmit={handleAddBranch} className="space-y-3 rounded-lg border border-dashed border-ledger p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome da filial" required>
                <input
                  className="input"
                  required
                  value={newBranch.name}
                  onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })}
                />
              </Field>
              <Field label="Código" required>
                <input
                  className="input"
                  required
                  placeholder="002"
                  value={newBranch.code}
                  onChange={(e) => setNewBranch({ ...newBranch, code: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cidade">
                <input
                  className="input"
                  value={newBranch.city}
                  onChange={(e) => setNewBranch({ ...newBranch, city: e.target.value })}
                />
              </Field>
              <Field label="UF">
                <input
                  className="input"
                  maxLength={2}
                  value={newBranch.state}
                  onChange={(e) => setNewBranch({ ...newBranch, state: e.target.value.toUpperCase() })}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAdding(false)} className="btn-ghost">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? "Adicionando…" : "Adicionar filial"}
              </button>
            </div>
          </form>
        ) : (
          can("branches", "create") && (
            <button onClick={() => setAdding(true)} className="btn-ghost w-full justify-center border border-dashed border-ledger">
              <Plus size={15} />
              Adicionar filial
            </button>
          )
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Componentes utilitários de UI
// ---------------------------------------------------------------------------

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
      <div
        className={`animate-fade-in max-h-[90vh] w-full ${wide ? "max-w-xl" : "max-w-lg"} overflow-y-auto rounded-xl2 bg-surface p-6 shadow-popover`}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink-800">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-400 hover:bg-ink-50" aria-label="Fechar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}
