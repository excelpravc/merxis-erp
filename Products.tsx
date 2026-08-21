import { useEffect, useState } from "react";
import { Plus, Search, Package, Pencil, Tag, Bookmark } from "lucide-react";
import { api, ApiRequestError } from "./api";
import { usePermission } from "./permissions";
import type { Paginated, Product, ProductBrand, ProductCategory, ProductUnit } from "./types";

const UNIT_LABELS: Record<ProductUnit, string> = {
  UN: "Unidade",
  KG: "Quilograma",
  G: "Grama",
  L: "Litro",
  ML: "Mililitro",
  CX: "Caixa",
  PCT: "Pacote",
  DZ: "Dúzia",
};

export default function Products() {
  const { can } = usePermission();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [brands, setBrands] = useState<ProductBrand[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [productsRes, categoriesRes, brandsRes] = await Promise.all([
        api.get<Paginated<Product>>("/products", {
          search,
          categoryId: categoryFilter || undefined,
          page: 1,
          pageSize: 50,
        }),
        api.get<ProductCategory[]>("/products", { action: "categories" } as never),
        api.get<ProductBrand[]>("/products", { action: "brands" } as never),
      ]);
      setProducts(productsRes.items);
      setTotal(productsRes.total);
      setCategories(categoriesRes as unknown as ProductCategory[]);
      setBrands(brandsRes as unknown as ProductBrand[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, categoryFilter]);

  function currency(value: number) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink-800">Produtos</h1>
          <p className="mt-1 text-sm text-ink-400">{total} produto(s) cadastrado(s).</p>
        </div>
        {can("products", "create") && (
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="btn-accent"
          >
            <Plus size={16} />
            Novo produto
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative max-w-sm flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
          <input
            className="input pl-9"
            placeholder="Buscar por nome, SKU ou código de barras…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input max-w-[200px]"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-ledger bg-ink-50/60 text-left text-2xs font-semibold uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Preço de venda</th>
              <th className="px-4 py-3">Estoque total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ledger">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-400">
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && products.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-400">
                  Nenhum produto encontrado. Cadastre o primeiro produto para começar.
                </td>
              </tr>
            )}
            {products.map((p) => {
              const low = (p.totalStock ?? 0) <= p.minStock;
              return (
                <tr key={p.id} className="hover:bg-ink-50/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-50 text-ink-500">
                        <Package size={15} />
                      </div>
                      <div>
                        <p className="font-medium text-ink-800">{p.name}</p>
                        <p className="text-2xs text-ink-400">
                          {p.brandName ? `${p.brandName} · ` : ""}
                          {UNIT_LABELS[p.unit]}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="tabular px-4 py-3 text-ink-600">{p.sku}</td>
                  <td className="px-4 py-3 text-ink-600">{p.categoryName ?? "—"}</td>
                  <td className="tabular px-4 py-3 text-ink-800">{currency(p.salePrice)}</td>
                  <td className="tabular px-4 py-3">
                    <span className={low ? "font-medium text-danger" : "text-ink-600"}>
                      {p.totalStock ?? 0} {p.unit}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${p.active ? "bg-success/10 text-success" : "bg-ink-100 text-ink-400"}`}>
                      {p.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {can("products", "edit") && (
                      <button
                        onClick={() => {
                          setEditing(p);
                          setFormOpen(true);
                        }}
                        className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                        aria-label={`Editar ${p.name}`}
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <ProductFormModal
          product={editing}
          categories={categories}
          brands={brands}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            load();
          }}
          onCategoriesOrBrandsChanged={load}
        />
      )}
    </div>
  );
}

function ProductFormModal({
  product,
  categories,
  brands,
  onClose,
  onSaved,
  onCategoriesOrBrandsChanged,
}: {
  product: Product | null;
  categories: ProductCategory[];
  brands: ProductBrand[];
  onClose: () => void;
  onSaved: () => void;
  onCategoriesOrBrandsChanged: () => void;
}) {
  const isEdit = !!product;
  const [form, setForm] = useState({
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    name: product?.name ?? "",
    description: product?.description ?? "",
    categoryId: product?.categoryId ?? "",
    brandId: product?.brandId ?? "",
    unit: product?.unit ?? ("UN" as ProductUnit),
    costPrice: product?.costPrice ?? 0,
    salePrice: product?.salePrice ?? 0,
    minStock: product?.minStock ?? 0,
    maxStock: product?.maxStock ?? undefined,
    perishable: product?.perishable ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState<"category" | "brand" | null>(null);
  const [quickAddName, setQuickAddName] = useState("");

  const margin =
    form.costPrice > 0 ? (((form.salePrice - form.costPrice) / form.costPrice) * 100).toFixed(1) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        categoryId: form.categoryId || null,
        brandId: form.brandId || null,
        costPrice: Number(form.costPrice),
        salePrice: Number(form.salePrice),
        minStock: Number(form.minStock),
        maxStock: form.maxStock != null && form.maxStock !== ("" as unknown) ? Number(form.maxStock) : null,
      };
      if (isEdit) {
        await api.put("/products", { id: product!.id, ...payload });
      } else {
        await api.post("/products", payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.payload.message : "Erro ao salvar produto.");
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!quickAddName.trim()) return;
    const action = quickAdd === "category" ? "create-category" : "create-brand";
    try {
      const created = await api.post<{ id: string }>("/products", { action, name: quickAddName.trim() });
      if (quickAdd === "category") setForm((f) => ({ ...f, categoryId: created.id }));
      else setForm((f) => ({ ...f, brandId: created.id }));
      setQuickAddName("");
      setQuickAdd(null);
      onCategoriesOrBrandsChanged();
    } catch {
      // silencioso — usuário pode tentar novamente pelo mesmo campo
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="animate-fade-in max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl2 bg-surface p-6 shadow-popover">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink-800">
            {isEdit ? "Editar produto" : "Novo produto"}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-400 hover:bg-ink-50" aria-label="Fechar">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">SKU / Código interno *</label>
              <input
                className="input tabular"
                required
                disabled={isEdit}
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Código de barras (EAN/GTIN)</label>
              <input
                className="input tabular"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label">Nome do produto *</label>
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Categoria</label>
              {quickAdd === "category" ? (
                <form onSubmit={handleQuickAdd} className="flex gap-1.5">
                  <input
                    autoFocus
                    className="input"
                    placeholder="Nome da categoria"
                    value={quickAddName}
                    onChange={(e) => setQuickAddName(e.target.value)}
                  />
                  <button type="submit" className="btn-primary px-3 text-xs">
                    OK
                  </button>
                  <button type="button" onClick={() => setQuickAdd(null)} className="btn-ghost px-2 text-xs">
                    ✕
                  </button>
                </form>
              ) : (
                <div className="flex gap-1.5">
                  <select
                    className="input"
                    value={form.categoryId}
                    onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  >
                    <option value="">Sem categoria</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setQuickAdd("category")}
                    className="btn-ghost px-2"
                    aria-label="Nova categoria"
                  >
                    <Tag size={15} />
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="label">Marca</label>
              {quickAdd === "brand" ? (
                <form onSubmit={handleQuickAdd} className="flex gap-1.5">
                  <input
                    autoFocus
                    className="input"
                    placeholder="Nome da marca"
                    value={quickAddName}
                    onChange={(e) => setQuickAddName(e.target.value)}
                  />
                  <button type="submit" className="btn-primary px-3 text-xs">
                    OK
                  </button>
                  <button type="button" onClick={() => setQuickAdd(null)} className="btn-ghost px-2 text-xs">
                    ✕
                  </button>
                </form>
              ) : (
                <div className="flex gap-1.5">
                  <select
                    className="input"
                    value={form.brandId}
                    onChange={(e) => setForm({ ...form, brandId: e.target.value })}
                  >
                    <option value="">Sem marca</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setQuickAdd("brand")}
                    className="btn-ghost px-2"
                    aria-label="Nova marca"
                  >
                    <Bookmark size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Unidade</label>
              <select
                className="input"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value as ProductUnit })}
              >
                {Object.entries(UNIT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {value} — {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Preço de custo</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input tabular"
                value={form.costPrice}
                onChange={(e) => setForm({ ...form, costPrice: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">Preço de venda</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input tabular"
                value={form.salePrice}
                onChange={(e) => setForm({ ...form, salePrice: Number(e.target.value) })}
              />
            </div>
          </div>

          {margin && (
            <p className="text-2xs text-ink-400">
              Margem estimada: <span className="tabular font-medium text-ink-600">{margin}%</span>
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Estoque mínimo</label>
              <input
                type="number"
                step="0.001"
                min="0"
                className="input tabular"
                value={form.minStock}
                onChange={(e) => setForm({ ...form, minStock: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">Estoque máximo</label>
              <input
                type="number"
                step="0.001"
                min="0"
                className="input tabular"
                placeholder="Opcional"
                value={form.maxStock ?? ""}
                onChange={(e) => setForm({ ...form, maxStock: e.target.value === "" ? undefined : Number(e.target.value) })}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-600">
            <input
              type="checkbox"
              checked={form.perishable}
              onChange={(e) => setForm({ ...form, perishable: e.target.checked })}
            />
            Produto perecível (terá controle de lote e validade nas próximas fases)
          </label>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Salvando…" : "Salvar produto"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
