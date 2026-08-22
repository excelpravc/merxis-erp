import type { VercelRequest, VercelResponse } from "@vercel/node";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { query, queryOne, exec } from "./_db.js";
import { resolveSession, requirePermission, type ResolvedSession } from "./_tenant.js";
import { badRequest, conflict, notFound, sendError, sendJson } from "./_http.js";
import { recordAudit } from "./_audit.js";
import type { Paginated, Supplier } from "../types.js";

// GET   /api/suppliers?search=&page=&pageSize=  -> lista fornecedores do tenant
// POST  /api/suppliers                           -> cria fornecedor
// PUT   /api/suppliers { id, ... }                -> edita fornecedor
// PATCH /api/suppliers { id, active }             -> ativa/inativa fornecedor

const supplierSchema = z.object({
  legalName: z.string().min(2, "Informe a razão social."),
  tradeName: z.string().optional().default(""),
  cnpj: z.string().optional().default(""),
  stateRegistration: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  email: z.string().email().optional().or(z.literal("")).default(""),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  paymentTerms: z.string().optional().default(""),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await resolveSession(req);

    if (req.method === "GET") {
      requirePermission(session, "suppliers", "view");
      return await listSuppliers(req, res, session.tenantId);
    }
    if (req.method === "POST") {
      requirePermission(session, "suppliers", "create");
      return await createSupplier(req, res, session);
    }
    if (req.method === "PUT") {
      requirePermission(session, "suppliers", "edit");
      return await updateSupplier(req, res, session);
    }
    if (req.method === "PATCH") {
      requirePermission(session, "suppliers", "edit");
      return await toggleActive(req, res, session);
    }
    throw badRequest("Método não suportado.");
  } catch (err) {
    sendError(res, err);
  }
}

function mapRow(row: Record<string, unknown>): Supplier {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    legalName: row.legal_name as string,
    tradeName: (row.trade_name as string) ?? null,
    cnpj: (row.cnpj as string) ?? null,
    stateRegistration: (row.state_registration as string) ?? null,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    city: (row.city as string) ?? null,
    state: (row.state as string) ?? null,
    paymentTerms: (row.payment_terms as string) ?? null,
    active: Boolean(row.active),
    createdAt: row.created_at as string,
  };
}

async function listSuppliers(req: VercelRequest, res: VercelResponse, tenantId: string) {
  const search = String(req.query.search ?? "").trim();
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
  const offset = (page - 1) * pageSize;

  const searchClause = search ? `AND (legal_name LIKE ? OR trade_name LIKE ? OR cnpj LIKE ?)` : "";
  const searchArgs = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];

  const rows = await query(
    `SELECT * FROM suppliers WHERE tenant_id = ? ${searchClause} ORDER BY legal_name ASC LIMIT ? OFFSET ?`,
    [tenantId, ...searchArgs, pageSize, offset]
  );
  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*) as total FROM suppliers WHERE tenant_id = ? ${searchClause}`,
    [tenantId, ...searchArgs]
  );

  const payload: Paginated<Supplier> = {
    items: rows.map(mapRow),
    total: countRow?.total ?? 0,
    page,
    pageSize,
  };
  sendJson(res, 200, payload);
}

async function createSupplier(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const parsed = supplierSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const data = parsed.data;

  if (data.cnpj) {
    const digits = data.cnpj.replace(/\D/g, "");
    const existing = await queryOne(`SELECT id FROM suppliers WHERE tenant_id = ? AND cnpj = ?`, [
      session.tenantId,
      digits,
    ]);
    if (existing) throw conflict("Já existe um fornecedor cadastrado com este CNPJ.");
  }

  const id = uuid();
  await exec(
    `INSERT INTO suppliers
      (id, tenant_id, legal_name, trade_name, cnpj, state_registration, phone, email, city, state, payment_terms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      session.tenantId,
      data.legalName,
      data.tradeName || null,
      data.cnpj ? data.cnpj.replace(/\D/g, "") : null,
      data.stateRegistration || null,
      data.phone || null,
      data.email || null,
      data.city || null,
      data.state || null,
      data.paymentTerms || null,
    ]
  );

  await recordAudit(session, {
    module: "suppliers",
    action: "create",
    recordId: id,
    description: `Fornecedor "${data.legalName}" cadastrado.`,
    newValue: data,
  });

  const row = await queryOne(`SELECT * FROM suppliers WHERE id = ?`, [id]);
  sendJson(res, 201, mapRow(row!));
}

async function updateSupplier(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const id = String(req.body?.id ?? "");
  if (!id) throw badRequest("Informe o fornecedor a ser editado.");

  const current = await queryOne<{ legal_name: string }>(
    `SELECT legal_name FROM suppliers WHERE id = ? AND tenant_id = ?`,
    [id, session.tenantId]
  );
  if (!current) throw notFound("Fornecedor não encontrado.");

  const parsed = supplierSchema.partial().safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const data = parsed.data;

  await exec(
    `UPDATE suppliers SET
      legal_name = COALESCE(?, legal_name),
      trade_name = COALESCE(?, trade_name),
      state_registration = COALESCE(?, state_registration),
      phone = COALESCE(?, phone),
      email = COALESCE(?, email),
      city = COALESCE(?, city),
      state = COALESCE(?, state),
      payment_terms = COALESCE(?, payment_terms)
     WHERE id = ? AND tenant_id = ?`,
    [
      data.legalName ?? null,
      data.tradeName ?? null,
      data.stateRegistration ?? null,
      data.phone ?? null,
      data.email ?? null,
      data.city ?? null,
      data.state ?? null,
      data.paymentTerms ?? null,
      id,
      session.tenantId,
    ]
  );

  await recordAudit(session, {
    module: "suppliers",
    action: "edit",
    recordId: id,
    description: `Fornecedor "${current.legal_name}" atualizado.`,
    previousValue: current,
    newValue: data,
  });

  const row = await queryOne(`SELECT * FROM suppliers WHERE id = ?`, [id]);
  sendJson(res, 200, mapRow(row!));
}

async function toggleActive(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const id = String(req.body?.id ?? "");
  const active = Boolean(req.body?.active);
  if (!id) throw badRequest("Informe o fornecedor.");

  const current = await queryOne<{ legal_name: string }>(
    `SELECT legal_name FROM suppliers WHERE id = ? AND tenant_id = ?`,
    [id, session.tenantId]
  );
  if (!current) throw notFound("Fornecedor não encontrado.");

  await exec(`UPDATE suppliers SET active = ? WHERE id = ? AND tenant_id = ?`, [
    active ? 1 : 0,
    id,
    session.tenantId,
  ]);

  await recordAudit(session, {
    module: "suppliers",
    action: active ? "activate" : "deactivate",
    recordId: id,
    description: `Fornecedor "${current.legal_name}" ${active ? "ativado" : "desativado"}.`,
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
