import { useEffect, useState } from "react";
import { Search, Boxes, ArrowUpCircle, ArrowDownCircle, History, AlertTriangle } from "lucide-react";
import { api, ApiRequestError } from "./api";
import { usePermission } from "./permissions";
import type { Branch, Paginated, StockLevel, StockMovement, StockMovementType } from "./types";

type StockRow = StockLevel & { productName: string; productSku: string };

const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  entry: "Entrada manual",
  exit: "Saída manual",
  purchase: "Compra",
  sale: "Venda",
  return: "Devolução",
  transfer_in: "Transferência (entrada)",
  transfer_out: "Transferência (saída)",
  adjustment: "Ajuste de inventário",
  loss: "Perda",
  damage: "Avaria",
  inventory: "Inventário",
};

const INBOUND_TYPES: StockMovementType[] = ["entry", "purchase", "return", "transfer_in", "adjustment", "inventory"];
const OUTBOUND_TYPES: StockMovementType[] = ["exit", "sale", "transfer_out", "loss", "damage"];

export default function Stock() {
  const { can } = usePermission();
  const [branches, setBranches] = useState<(Branch & { companyName?: string })[]>([]);
  const [branchId, setBranchId] = useState("");
  const [rows, setRows] = useState<StockRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [movementOpen, setMovementOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState<StockRow | null>(null);

  async function loadBranches() {
    const res = await api.get<Paginated<Branch & { companyName?: string }>>("/companies", {
      action: "branches",
    } as never);
    setBranches(res.items);
  }

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<Paginated<StockRow>>("/stock", {
        branchId: branchId || undefined,
        search,
        lowOnly,
        page: 1,
        pageSize: 100,
      });
      setRows(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, branchId, lowOnly]);

  const lowCount = rows.filter((r) => r.quantity <= r.minStock).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink-800">Estoque</h1>
          <p className="mt-1 text-sm text-ink-400">
            {total} posição(ões) de estoque · {lowCount} abaixo do mínimo nesta lista.
          </p>
        </div>
        {can("stock", "change_stock") && (
          <button onClick={() => setMovementOpen(true)} className="btn-accent">
            <Boxes size={16} />
            Registrar movimentação
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
          <input
            className="input pl-9"
            placeholder="Buscar por produto, SKU ou código de barras…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input max-w-[220px]" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">Todas as filiais</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.companyName ? `${b.companyName} — ` : ""}
              {b.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Somente estoque baixo
        </label>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-ledger bg-ink-50/60 text-left text-2xs font-semibold uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Filial</th>
              <th className="px-4 py-3">Saldo</th>
              <th className="px-4 py-3">Mínimo / Máximo</th>
              <th className="px-4 py-3">Atualizado em</th>
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
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-400">
                  Nenhuma posição de estoque encontrada. Cadastre produtos para vê-los aqui.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const low = r.quantity <= r.minStock;
              return (
                <tr key={`${r.productId}-${r.branchId}`} className="hover:bg-ink-50/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink-800">{r.productName}</p>
                    <p className="tabular text-2xs text-ink-400">{r.productSku}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-600">{r.branchName}</td>
                  <td className="px-4 py-3">
                    <span className={`tabular font-medium ${low ? "text-danger" : "text-ink-800"}`}>
                      {r.quantity}
                    </span>
                    {low && (
                      <span className="ml-2 inline-flex items-center gap-1 text-2xs font-medium text-danger">
                        <AlertTriangle size={12} />
                        baixo
                      </span>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 text-ink-500">
                    {r.minStock} / {r.maxStock ?? "—"}
                  </td>
                  <td className="tabular px-4 py-3 text-ink-500">
                    {new Date(r.updatedAt).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setHistoryOpen(r)}
                      className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                      aria-label="Ver histórico"
                    >
                      <History size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {movementOpen && (
        <MovementFormModal
          branches={branches}
          onClose={() => setMovementOpen(false)}
          onSaved={() => {
            setMovementOpen(false);
            load();
          }}
        />
      )}

      {historyOpen && (
        <MovementHistoryModal row={historyOpen} onClose={() => setHistoryOpen(null)} />
      )}
    </div>
  );
}

function MovementFormModal({
  branches,
  onClose,
  onSaved,
}: {
  branches: (Branch & { companyName?: string })[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [form, setForm] = useState({
    productSearch: "",
    productId: "",
    productLabel: "",
    branchId: branches[0]?.id ?? "",
    type: "entry" as StockMovementType,
    quantity: 1,
    notes: "",
  });
  const [suggestions, setSuggestions] = useState<{ id: string; name: string; sku: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!form.productSearch || form.productId) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await api.get<{ items: { id: string; name: string; sku: string }[] }>("/products", {
        search: form.productSearch,
        page: 1,
        pageSize: 8,
      });
      setSuggestions(res.items);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.productSearch]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.productId) {
      setError("Selecione um produto na busca antes de continuar.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post("/stock", {
        productId: form.productId,
        branchId: form.branchId,
        type: form.type,
        quantity: form.quantity,
        notes: form.notes,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.payload.message : "Erro ao registrar movimentação.");
    } finally {
      setSaving(false);
    }
  }

  const typeOptions = direction === "in" ? INBOUND_TYPES : OUTBOUND_TYPES;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="animate-fade-in max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl2 bg-surface p-6 shadow-popover">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink-800">Registrar movimentação</h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-400 hover:bg-ink-50" aria-label="Fechar">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setDirection("in");
                setForm((f) => ({ ...f, type: "entry" }));
              }}
              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                direction === "in" ? "border-success/30 bg-success/10 text-success" : "border-ledger text-ink-500"
              }`}
            >
              <ArrowUpCircle size={16} />
              Entrada
            </button>
            <button
              type="button"
              onClick={() => {
                setDirection("out");
                setForm((f) => ({ ...f, type: "exit" }));
              }}
              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                direction === "out" ? "border-danger/30 bg-danger/10 text-danger" : "border-ledger text-ink-500"
              }`}
            >
              <ArrowDownCircle size={16} />
              Saída
            </button>
          </div>

          <div className="relative">
            <label className="label">Produto *</label>
            {form.productId ? (
              <div className="flex items-center justify-between rounded-lg border border-ledger px-3 py-2 text-sm">
                <span className="text-ink-800">{form.productLabel}</span>
                <button
                  type="button"
                  className="text-2xs text-ink-400 hover:text-ink-700"
                  onClick={() => setForm({ ...form, productId: "", productLabel: "", productSearch: "" })}
                >
                  Trocar
                </button>
              </div>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="Buscar por nome ou SKU…"
                  value={form.productSearch}
                  onChange={(e) => setForm({ ...form, productSearch: e.target.value })}
                />
                {suggestions.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full rounded-lg border border-ledger bg-surface shadow-popover">
                    {suggestions.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-ink-50"
                          onClick={() =>
                            setForm({ ...form, productId: p.id, productLabel: `${p.name} (${p.sku})`, productSearch: "" })
                          }
                        >
                          <span>{p.name}</span>
                          <span className="tabular text-2xs text-ink-400">{p.sku}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Filial *</label>
              <select
                className="input"
                required
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Tipo *</label>
              <select
                className="input"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as StockMovementType })}
              >
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {MOVEMENT_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Quantidade *</label>
            <input
              type="number"
              step="0.001"
              min="0.001"
              required
              className="input tabular"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            />
          </div>

          <div>
            <label className="label">Observação</label>
            <textarea
              className="input"
              rows={2}
              placeholder="Ex: contagem de inventário, motivo da perda…"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Registrando…" : "Registrar movimentação"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MovementHistoryModal({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await api.get<Paginated<StockMovement>>("/stock", {
          action: "movements",
          productId: row.productId,
          branchId: row.branchId,
          page: 1,
          pageSize: 30,
        } as never);
        setMovements(res.items);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.productId, row.branchId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="animate-fade-in max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl2 bg-surface p-6 shadow-popover">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink-800">Histórico de movimentações</h2>
            <p className="text-2xs text-ink-400">
              {row.productName} · {row.branchName}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-ink-400 hover:bg-ink-50" aria-label="Fechar">
            ✕
          </button>
        </div>

        {loading && <p className="text-sm text-ink-400">Carregando…</p>}
        {!loading && movements.length === 0 && (
          <p className="text-sm text-ink-400">Nenhuma movimentação registrada ainda.</p>
        )}

        <ul className="space-y-2">
          {movements.map((m) => {
            const isOutbound = OUTBOUND_TYPES.includes(m.type);
            return (
              <li key={m.id} className="flex items-center justify-between rounded-lg border border-ledger px-3 py-2">
                <div className="flex items-center gap-2">
                  {isOutbound ? (
                    <ArrowDownCircle size={16} className="text-danger" />
                  ) : (
                    <ArrowUpCircle size={16} className="text-success" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-ink-800">{MOVEMENT_LABELS[m.type]}</p>
                    <p className="text-2xs text-ink-400">
                      {new Date(m.createdAt).toLocaleString("pt-BR")}
                      {m.userName ? ` · ${m.userName}` : ""}
                      {m.notes ? ` · ${m.notes}` : ""}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`tabular text-sm font-medium ${isOutbound ? "text-danger" : "text-success"}`}>
                    {isOutbound ? "-" : "+"}
                    {m.quantity}
                  </p>
                  <p className="tabular text-2xs text-ink-400">
                    {m.previousQuantity} → {m.newQuantity}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
