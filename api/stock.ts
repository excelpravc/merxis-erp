import type { VercelRequest, VercelResponse } from "@vercel/node";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { query, queryOne, exec } from "./_db";
import { resolveSession, requirePermission, type ResolvedSession } from "./_tenant";
import { badRequest, conflict, notFound, sendError, sendJson } from "./_http";
import { recordAudit } from "./_audit";
import type { Paginated, StockLevel, StockMovement, StockMovementType } from "../types";

// GET  /api/stock?branchId=&search=&lowOnly=&page=&pageSize=      -> posição de estoque
// GET  /api/stock?action=movements&productId=&branchId=&page=&pageSize= -> histórico
// POST /api/stock { productId, branchId, type, quantity, notes }  -> movimentação manual
//
// Toda movimentação passa por aqui — nunca se altera `stock.quantity`
// diretamente sem registrar o histórico correspondente (regra #10 do briefing).

const MOVEMENT_TYPES: [StockMovementType, ...StockMovementType[]] = [
  "entry",
  "exit",
  "purchase",
  "sale",
  "return",
  "transfer_in",
  "transfer_out",
  "adjustment",
  "loss",
  "damage",
  "inventory",
];

// Tipos que reduzem o estoque (não podem deixar a quantidade negativa).
const OUTBOUND_TYPES = new Set<StockMovementType>(["exit", "sale", "transfer_out", "loss", "damage"]);

const movementSchema = z.object({
  productId: z.string().min(1, "Informe o produto."),
  branchId: z.string().min(1, "Informe a filial."),
  type: z.enum(MOVEMENT_TYPES),
  quantity: z.number().positive("A quantidade deve ser maior que zero."),
  notes: z.string().optional().default(""),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await resolveSession(req);

    if (req.method === "GET") {
      const action = String(req.query.action ?? "");
      requirePermission(session, "stock", "view");
      if (action === "movements") return await listMovements(req, res, session.tenantId);
      return await listStock(req, res, session.tenantId);
    }

    if (req.method === "POST") {
      requirePermission(session, "stock", "change_stock");
      return await createMovement(req, res, session);
    }

    throw badRequest("Método não suportado.");
  } catch (err) {
    sendError(res, err);
  }
}

async function listStock(req: VercelRequest, res: VercelResponse, tenantId: string) {
  const branchId = String(req.query.branchId ?? "");
  const search = String(req.query.search ?? "").trim();
  const lowOnly = String(req.query.lowOnly ?? "") === "true";
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 30)));
  const offset = (page - 1) * pageSize;

  const filters: string[] = ["s.tenant_id = ?"];
  const args: (string | number)[] = [tenantId];
  if (branchId) {
    filters.push("s.branch_id = ?");
    args.push(branchId);
  }
  if (search) {
    filters.push("(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)");
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (lowOnly) {
    filters.push("s.quantity <= p.min_stock");
  }
  const whereClause = filters.join(" AND ");

  const rows = await query(
    `SELECT s.product_id, s.branch_id, s.quantity, s.reserved_quantity, s.updated_at,
            p.name as product_name, p.sku as product_sku, p.min_stock, p.max_stock,
            br.name as branch_name
     FROM stock s
     JOIN products p ON p.id = s.product_id
     JOIN branches br ON br.id = s.branch_id
     WHERE ${whereClause}
     ORDER BY p.name ASC LIMIT ? OFFSET ?`,
    [...args, pageSize, offset]
  );
  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*) as total FROM stock s JOIN products p ON p.id = s.product_id WHERE ${whereClause}`,
    args
  );

  const items = rows.map((r) => ({
    productId: r.product_id as string,
    productName: r.product_name as string,
    productSku: r.product_sku as string,
    branchId: r.branch_id as string,
    branchName: r.branch_name as string,
    quantity: Number(r.quantity),
    reservedQuantity: Number(r.reserved_quantity),
    minStock: Number(r.min_stock),
    maxStock: r.max_stock != null ? Number(r.max_stock) : null,
    updatedAt: r.updated_at as string,
  }));

  const payload: Paginated<StockLevel & { productName: string; productSku: string }> = {
    items,
    total: countRow?.total ?? 0,
    page,
    pageSize,
  };
  sendJson(res, 200, payload);
}

async function listMovements(req: VercelRequest, res: VercelResponse, tenantId: string) {
  const productId = String(req.query.productId ?? "");
  const branchId = String(req.query.branchId ?? "");
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 30)));
  const offset = (page - 1) * pageSize;

  const filters: string[] = ["m.tenant_id = ?"];
  const args: (string | number)[] = [tenantId];
  if (productId) {
    filters.push("m.product_id = ?");
    args.push(productId);
  }
  if (branchId) {
    filters.push("m.branch_id = ?");
    args.push(branchId);
  }
  const whereClause = filters.join(" AND ");

  const rows = await query(
    `SELECT m.*, p.name as product_name, br.name as branch_name, u.name as user_name
     FROM stock_movements m
     JOIN products p ON p.id = m.product_id
     JOIN branches br ON br.id = m.branch_id
     LEFT JOIN users u ON u.id = m.user_id
     WHERE ${whereClause}
     ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, offset]
  );
  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*) as total FROM stock_movements m WHERE ${whereClause}`,
    args
  );

  const items: StockMovement[] = rows.map((r) => ({
    id: r.id as string,
    tenantId: r.tenant_id as string,
    branchId: r.branch_id as string,
    branchName: r.branch_name as string,
    productId: r.product_id as string,
    productName: r.product_name as string,
    type: r.type as StockMovementType,
    quantity: Number(r.quantity),
    previousQuantity: Number(r.previous_quantity),
    newQuantity: Number(r.new_quantity),
    referenceType: (r.reference_type as string) ?? null,
    referenceId: (r.reference_id as string) ?? null,
    notes: (r.notes as string) ?? null,
    userName: (r.user_name as string) ?? undefined,
    createdAt: r.created_at as string,
  }));

  const payload: Paginated<StockMovement> = { items, total: countRow?.total ?? 0, page, pageSize };
  sendJson(res, 200, payload);
}

async function createMovement(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const parsed = movementSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const data = parsed.data;

  const product = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM products WHERE id = ? AND tenant_id = ?`,
    [data.productId, session.tenantId]
  );
  if (!product) throw notFound("Produto não encontrado.");

  const branch = await queryOne<{ id: string }>(`SELECT id FROM branches WHERE id = ? AND tenant_id = ?`, [
    data.branchId,
    session.tenantId,
  ]);
  if (!branch) throw notFound("Filial não encontrada.");

  let stockRow = await queryOne<{ quantity: number }>(
    `SELECT quantity FROM stock WHERE branch_id = ? AND product_id = ?`,
    [data.branchId, data.productId]
  );
  if (!stockRow) {
    // Produto cadastrado antes da filial existir, ou vice-versa — cria a linha zerada agora.
    await exec(`INSERT INTO stock (id, tenant_id, branch_id, product_id, quantity) VALUES (?, ?, ?, ?, 0)`, [
      uuid(),
      session.tenantId,
      data.branchId,
      data.productId,
    ]);
    stockRow = { quantity: 0 };
  }

  const isOutbound = OUTBOUND_TYPES.has(data.type);
  const delta = isOutbound ? -data.quantity : data.quantity;
  const previousQuantity = stockRow.quantity;
  const newQuantity = previousQuantity + delta;

  if (newQuantity < 0) {
    throw conflict(
      `Estoque insuficiente. Saldo atual: ${previousQuantity}. Movimentação cancelada para evitar estoque negativo.`
    );
  }

  // Guarda otimista: só aplica se a quantidade não mudou entre a leitura e a escrita
  // (evita corrida entre dois usuários movimentando o mesmo produto ao mesmo tempo).
  const updateResult = await exec(
    `UPDATE stock SET quantity = ?, updated_at = datetime('now')
     WHERE branch_id = ? AND product_id = ? AND quantity = ?`,
    [newQuantity, data.branchId, data.productId, previousQuantity]
  );
  if (updateResult.rowsAffected === 0) {
    throw conflict("O estoque deste produto foi alterado por outra operação. Tente novamente.");
  }

  const movementId = uuid();
  await exec(
    `INSERT INTO stock_movements
      (id, tenant_id, branch_id, product_id, type, quantity, previous_quantity, new_quantity, notes, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      movementId,
      session.tenantId,
      data.branchId,
      data.productId,
      data.type,
      data.quantity,
      previousQuantity,
      newQuantity,
      data.notes || null,
      session.userId,
    ]
  );

  await recordAudit(session, {
    module: "stock",
    action: "change_stock",
    recordId: data.productId,
    description: `Estoque do produto "${product.name}" ajustado de ${previousQuantity} para ${newQuantity} (${data.type}).`,
    previousValue: { quantity: previousQuantity },
    newValue: { quantity: newQuantity },
  });

  sendJson(res, 201, {
    id: movementId,
    productId: data.productId,
    branchId: data.branchId,
    type: data.type,
    quantity: data.quantity,
    previousQuantity,
    newQuantity,
  });
}

function flattenZod(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fields[key] = issue.message;
  }
  return fields;
}
