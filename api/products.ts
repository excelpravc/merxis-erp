import type { VercelRequest, VercelResponse } from "@vercel/node";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { query, queryOne, exec } from "./_db";
import { resolveSession, requirePermission, type ResolvedSession } from "./_tenant";
import { badRequest, conflict, notFound, sendError, sendJson } from "./_http";
import { recordAudit } from "./_audit";
import type { Paginated, Product, ProductBrand, ProductCategory, ProductUnit } from "../types";

// GET   /api/products?search=&categoryId=&page=&pageSize=  -> lista produtos do tenant
// GET   /api/products?action=categories                    -> lista categorias
// GET   /api/products?action=brands                        -> lista marcas
// POST  /api/products                                       -> cria produto
// POST  /api/products { action: "create-category", name }   -> cria categoria
// POST  /api/products { action: "create-brand", name }      -> cria marca
// PUT   /api/products { id, ... }                            -> edita produto
// PATCH /api/products { id, active }                         -> ativa/inativa produto
//
// tenant_id sempre vem da sessão — nunca do corpo da requisição.

const UNITS: [ProductUnit, ...ProductUnit[]] = ["UN", "KG", "G", "L", "ML", "CX", "PCT", "DZ"];

const productSchema = z.object({
  sku: z.string().min(1, "Informe o código/SKU."),
  barcode: z.string().optional().default(""),
  name: z.string().min(2, "Informe o nome do produto."),
  description: z.string().optional().default(""),
  categoryId: z.string().optional().nullable(),
  brandId: z.string().optional().nullable(),
  unit: z.enum(UNITS).default("UN"),
  costPrice: z.number().min(0).default(0),
  salePrice: z.number().min(0).default(0),
  minStock: z.number().min(0).default(0),
  maxStock: z.number().min(0).optional().nullable(),
  perishable: z.boolean().optional().default(false),
});

const nameOnlySchema = z.object({ name: z.string().min(1, "Informe o nome.") });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await resolveSession(req);

    if (req.method === "GET") {
      const action = String(req.query.action ?? "");
      requirePermission(session, "products", "view");
      if (action === "categories") return await listCategories(res, session.tenantId);
      if (action === "brands") return await listBrands(res, session.tenantId);
      return await listProducts(req, res, session.tenantId);
    }

    if (req.method === "POST") {
      const action = String(req.body?.action ?? "");
      if (action === "create-category") {
        requirePermission(session, "products", "create");
        return await createCategory(req, res, session);
      }
      if (action === "create-brand") {
        requirePermission(session, "products", "create");
        return await createBrand(req, res, session);
      }
      requirePermission(session, "products", "create");
      return await createProduct(req, res, session);
    }

    if (req.method === "PUT") {
      requirePermission(session, "products", "edit");
      return await updateProduct(req, res, session);
    }

    if (req.method === "PATCH") {
      requirePermission(session, "products", "edit");
      return await toggleActive(req, res, session);
    }

    throw badRequest("Método não suportado.");
  } catch (err) {
    sendError(res, err);
  }
}

function mapProductRow(row: Record<string, unknown>): Product {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    sku: row.sku as string,
    barcode: (row.barcode as string) ?? null,
    name: row.name as string,
    description: (row.description as string) ?? null,
    categoryId: (row.category_id as string) ?? null,
    categoryName: (row.category_name as string) ?? null,
    brandId: (row.brand_id as string) ?? null,
    brandName: (row.brand_name as string) ?? null,
    unit: row.unit as ProductUnit,
    costPrice: Number(row.cost_price ?? 0),
    salePrice: Number(row.sale_price ?? 0),
    minStock: Number(row.min_stock ?? 0),
    maxStock: row.max_stock != null ? Number(row.max_stock) : null,
    perishable: Boolean(row.perishable),
    active: Boolean(row.active),
    totalStock: row.total_stock != null ? Number(row.total_stock) : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

async function listProducts(req: VercelRequest, res: VercelResponse, tenantId: string) {
  const search = String(req.query.search ?? "").trim();
  const categoryId = String(req.query.categoryId ?? "");
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
  const offset = (page - 1) * pageSize;

  const filters: string[] = ["p.tenant_id = ?"];
  const args: (string | number)[] = [tenantId];
  if (search) {
    filters.push("(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)");
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (categoryId) {
    filters.push("p.category_id = ?");
    args.push(categoryId);
  }
  const whereClause = filters.join(" AND ");

  const rows = await query(
    `SELECT p.*, c.name as category_name, b.name as brand_name,
            COALESCE((SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.id), 0) as total_stock
     FROM products p
     LEFT JOIN product_categories c ON c.id = p.category_id
     LEFT JOIN product_brands b ON b.id = p.brand_id
     WHERE ${whereClause}
     ORDER BY p.name ASC LIMIT ? OFFSET ?`,
    [...args, pageSize, offset]
  );
  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*) as total FROM products p WHERE ${whereClause}`,
    args
  );

  const payload: Paginated<Product> = {
    items: rows.map(mapProductRow),
    total: countRow?.total ?? 0,
    page,
    pageSize,
  };
  sendJson(res, 200, payload);
}

async function listCategories(res: VercelResponse, tenantId: string) {
  const rows = await query(`SELECT * FROM product_categories WHERE tenant_id = ? ORDER BY name ASC`, [
    tenantId,
  ]);
  const payload: ProductCategory[] = rows.map((r) => ({
    id: r.id as string,
    tenantId: r.tenant_id as string,
    name: r.name as string,
    parentId: (r.parent_id as string) ?? null,
    createdAt: r.created_at as string,
  }));
  sendJson(res, 200, payload);
}

async function listBrands(res: VercelResponse, tenantId: string) {
  const rows = await query(`SELECT * FROM product_brands WHERE tenant_id = ? ORDER BY name ASC`, [tenantId]);
  const payload: ProductBrand[] = rows.map((r) => ({
    id: r.id as string,
    tenantId: r.tenant_id as string,
    name: r.name as string,
    createdAt: r.created_at as string,
  }));
  sendJson(res, 200, payload);
}

async function createCategory(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const parsed = nameOnlySchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Informe o nome da categoria.");

  const existing = await queryOne(
    `SELECT id FROM product_categories WHERE tenant_id = ? AND name = ? AND parent_id IS NULL`,
    [session.tenantId, parsed.data.name]
  );
  if (existing) throw conflict("Já existe uma categoria com este nome.");

  const id = uuid();
  await exec(`INSERT INTO product_categories (id, tenant_id, name) VALUES (?, ?, ?)`, [
    id,
    session.tenantId,
    parsed.data.name,
  ]);
  const row = await queryOne(`SELECT * FROM product_categories WHERE id = ?`, [id]);
  sendJson(res, 201, {
    id: row!.id,
    tenantId: row!.tenant_id,
    name: row!.name,
    parentId: row!.parent_id ?? null,
    createdAt: row!.created_at,
  });
}

async function createBrand(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const parsed = nameOnlySchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Informe o nome da marca.");

  const existing = await queryOne(`SELECT id FROM product_brands WHERE tenant_id = ? AND name = ?`, [
    session.tenantId,
    parsed.data.name,
  ]);
  if (existing) throw conflict("Já existe uma marca com este nome.");

  const id = uuid();
  await exec(`INSERT INTO product_brands (id, tenant_id, name) VALUES (?, ?, ?)`, [
    id,
    session.tenantId,
    parsed.data.name,
  ]);
  const row = await queryOne(`SELECT * FROM product_brands WHERE id = ?`, [id]);
  sendJson(res, 201, { id: row!.id, tenantId: row!.tenant_id, name: row!.name, createdAt: row!.created_at });
}

async function createProduct(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const data = parsed.data;

  const existingSku = await queryOne(`SELECT id FROM products WHERE tenant_id = ? AND sku = ?`, [
    session.tenantId,
    data.sku,
  ]);
  if (existingSku) throw conflict("Já existe um produto com este código/SKU.");

  const id = uuid();
  await exec(
    `INSERT INTO products
      (id, tenant_id, sku, barcode, name, description, category_id, brand_id, unit,
       cost_price, sale_price, min_stock, max_stock, perishable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      session.tenantId,
      data.sku,
      data.barcode || null,
      data.name,
      data.description || null,
      data.categoryId || null,
      data.brandId || null,
      data.unit,
      data.costPrice,
      data.salePrice,
      data.minStock,
      data.maxStock ?? null,
      data.perishable ? 1 : 0,
    ]
  );

  // Cria a linha de estoque zerada em todas as filiais existentes, para que o
  // produto já apareça nos relatórios/PDV de qualquer filial assim que for cadastrado.
  const branches = await query<{ id: string }>(`SELECT id FROM branches WHERE tenant_id = ?`, [
    session.tenantId,
  ]);
  for (const branch of branches) {
    await exec(
      `INSERT INTO stock (id, tenant_id, branch_id, product_id, quantity) VALUES (?, ?, ?, ?, 0)`,
      [uuid(), session.tenantId, branch.id, id]
    );
  }

  await recordAudit(session, {
    module: "products",
    action: "create",
    recordId: id,
    description: `Produto "${data.name}" (SKU ${data.sku}) cadastrado.`,
    newValue: data,
  });

  const row = await queryOne(
    `SELECT p.*, c.name as category_name, b.name as brand_name FROM products p
     LEFT JOIN product_categories c ON c.id = p.category_id
     LEFT JOIN product_brands b ON b.id = p.brand_id
     WHERE p.id = ?`,
    [id]
  );
  sendJson(res, 201, mapProductRow(row!));
}

async function updateProduct(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const id = String(req.body?.id ?? "");
  if (!id) throw badRequest("Informe o produto a ser editado.");

  const current = await queryOne(`SELECT * FROM products WHERE id = ? AND tenant_id = ?`, [
    id,
    session.tenantId,
  ]);
  if (!current) throw notFound("Produto não encontrado.");

  const parsed = productSchema.partial().safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const data = parsed.data;

  await exec(
    `UPDATE products SET
      name = COALESCE(?, name),
      barcode = COALESCE(?, barcode),
      description = COALESCE(?, description),
      category_id = COALESCE(?, category_id),
      brand_id = COALESCE(?, brand_id),
      unit = COALESCE(?, unit),
      cost_price = COALESCE(?, cost_price),
      sale_price = COALESCE(?, sale_price),
      min_stock = COALESCE(?, min_stock),
      max_stock = COALESCE(?, max_stock),
      perishable = COALESCE(?, perishable),
      updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ?`,
    [
      data.name ?? null,
      data.barcode ?? null,
      data.description ?? null,
      data.categoryId ?? null,
      data.brandId ?? null,
      data.unit ?? null,
      data.costPrice ?? null,
      data.salePrice ?? null,
      data.minStock ?? null,
      data.maxStock ?? null,
      data.perishable != null ? (data.perishable ? 1 : 0) : null,
      id,
      session.tenantId,
    ]
  );

  await recordAudit(session, {
    module: "products",
    action: "edit",
    recordId: id,
    description: `Produto "${current.name}" atualizado.`,
    previousValue: current,
    newValue: data,
  });

  const row = await queryOne(
    `SELECT p.*, c.name as category_name, b.name as brand_name FROM products p
     LEFT JOIN product_categories c ON c.id = p.category_id
     LEFT JOIN product_brands b ON b.id = p.brand_id
     WHERE p.id = ?`,
    [id]
  );
  sendJson(res, 200, mapProductRow(row!));
}

async function toggleActive(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const id = String(req.body?.id ?? "");
  const active = Boolean(req.body?.active);
  if (!id) throw badRequest("Informe o produto.");

  const current = await queryOne<{ name: string }>(`SELECT name FROM products WHERE id = ? AND tenant_id = ?`, [
    id,
    session.tenantId,
  ]);
  if (!current) throw notFound("Produto não encontrado.");

  await exec(`UPDATE products SET active = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`, [
    active ? 1 : 0,
    id,
    session.tenantId,
  ]);

  await recordAudit(session, {
    module: "products",
    action: active ? "activate" : "deactivate",
    recordId: id,
    description: `Produto "${current.name}" ${active ? "ativado" : "desativado"}.`,
  });

  sendJson(res, 200, { ok: true });
}

function flattenZod(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fields[key] = issue.message;
  }
  return fields;
}
