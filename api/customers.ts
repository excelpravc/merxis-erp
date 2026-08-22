import type { VercelRequest, VercelResponse } from "@vercel/node";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { query, queryOne, exec } from "./_db.js";
import { resolveSession, requirePermission, type ResolvedSession } from "./_tenant.js";
import { badRequest, notFound, sendError, sendJson } from "./_http.js";
import { recordAudit } from "./_audit.js";
import type { Customer, Paginated } from "../types.js";

// GET   /api/customers?search=&page=&pageSize=  -> lista clientes do tenant
// POST  /api/customers                           -> cria cliente
// PUT   /api/customers { id, ... }                -> edita cliente
// PATCH /api/customers { id, active }             -> ativa/inativa cliente

const customerSchema = z.object({
  name: z.string().min(2, "Informe o nome do cliente."),
  document: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  email: z.string().email().optional().or(z.literal("")).default(""),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  creditLimit: z.number().min(0).default(0),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await resolveSession(req);

    if (req.method === "GET") {
      requirePermission(session, "customers", "view");
      return await listCustomers(req, res, session.tenantId);
    }
    if (req.method === "POST") {
      requirePermission(session, "customers", "create");
      return await createCustomer(req, res, session);
    }
    if (req.method === "PUT") {
      requirePermission(session, "customers", "edit");
      return await updateCustomer(req, res, session);
    }
    if (req.method === "PATCH") {
      requirePermission(session, "customers", "edit");
      return await toggleActive(req, res, session);
    }
    throw badRequest("Método não suportado.");
  } catch (err) {
    sendError(res, err);
  }
}

function mapRow(row: Record<string, unknown>): Customer {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    name: row.name as string,
    document: (row.document as string) ?? null,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    city: (row.city as string) ?? null,
    state: (row.state as string) ?? null,
    creditLimit: Number(row.credit_limit ?? 0),
    active: Boolean(row.active),
    createdAt: row.created_at as string,
  };
}

async function listCustomers(req: VercelRequest, res: VercelResponse, tenantId: string) {
  const search = String(req.query.search ?? "").trim();
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
  const offset = (page - 1) * pageSize;

  const searchClause = search ? `AND (name LIKE ? OR document LIKE ? OR phone LIKE ?)` : "";
  const searchArgs = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];

  const rows = await query(
    `SELECT * FROM customers WHERE tenant_id = ? ${searchClause} ORDER BY name ASC LIMIT ? OFFSET ?`,
    [tenantId, ...searchArgs, pageSize, offset]
  );
  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*) as total FROM customers WHERE tenant_id = ? ${searchClause}`,
    [tenantId, ...searchArgs]
  );

  const payload: Paginated<Customer> = {
    items: rows.map(mapRow),
    total: countRow?.total ?? 0,
    page,
    pageSize,
  };
  sendJson(res, 200, payload);
}

async function createCustomer(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const data = parsed.data;

  const id = uuid();
  await exec(
    `INSERT INTO customers (id, tenant_id, name, document, phone, email, city, state, credit_limit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      session.tenantId,
      data.name,
      data.document ? data.document.replace(/\D/g, "") : null,
      data.phone || null,
      data.email || null,
      data.city || null,
      data.state || null,
      data.creditLimit,
    ]
  );

  await recordAudit(session, {
    module: "customers",
    action: "create",
    recordId: id,
    description: `Cliente "${data.name}" cadastrado.`,
    newValue: data,
  });

  const row = await queryOne(`SELECT * FROM customers WHERE id = ?`, [id]);
  sendJson(res, 201, mapRow(row!));
}

async function updateCustomer(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const id = String(req.body?.id ?? "");
  if (!id) throw badRequest("Informe o cliente a ser editado.");

  const current = await queryOne<{ name: string }>(`SELECT name FROM customers WHERE id = ? AND tenant_id = ?`, [
    id,
    session.tenantId,
  ]);
  if (!current) throw notFound("Cliente não encontrado.");

  const parsed = customerSchema.partial().safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const data = parsed.data;

  await exec(
    `UPDATE customers SET
      name = COALESCE(?, name),
      phone = COALESCE(?, phone),
      email = COALESCE(?, email),
      city = COALESCE(?, city),
      state = COALESCE(?, state),
      credit_limit = COALESCE(?, credit_limit)
     WHERE id = ? AND tenant_id = ?`,
    [
      data.name ?? null,
      data.phone ?? null,
      data.email ?? null,
      data.city ?? null,
      data.state ?? null,
      data.creditLimit ?? null,
      id,
      session.tenantId,
    ]
  );

  await recordAudit(session, {
    module: "customers",
    action: "edit",
    recordId: id,
    description: `Cliente "${current.name}" atualizado.`,
    previousValue: current,
    newValue: data,
  });

  const row = await queryOne(`SELECT * FROM customers WHERE id = ?`, [id]);
  sendJson(res, 200, mapRow(row!));
}

async function toggleActive(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const id = String(req.body?.id ?? "");
  const active = Boolean(req.body?.active);
  if (!id) throw badRequest("Informe o cliente.");

  const current = await queryOne<{ name: string }>(`SELECT name FROM customers WHERE id = ? AND tenant_id = ?`, [
    id,
    session.tenantId,
  ]);
  if (!current) throw notFound("Cliente não encontrado.");

  await exec(`UPDATE customers SET active = ? WHERE id = ? AND tenant_id = ?`, [
    active ? 1 : 0,
    id,
    session.tenantId,
  ]);

  await recordAudit(session, {
    module: "customers",
    action: active ? "activate" : "deactivate",
    recordId: id,
    description: `Cliente "${current.name}" ${active ? "ativado" : "desativado"}.`,
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
