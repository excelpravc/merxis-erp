import type { VercelRequest, VercelResponse } from "@vercel/node";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { query, queryOne, exec } from "./_db.js";
import { resolveSession, requirePermission, type ResolvedSession } from "./_tenant.js";
import { badRequest, conflict, notFound, sendError, sendJson } from "./_http.js";
import { recordAudit } from "./_audit.js";
import type { Branch, Company, Paginated } from "../types.js";

// GET    /api/companies?search=&page=&pageSize=          -> lista empresas do tenant
// GET    /api/companies?action=branches&companyId=       -> lista filiais de uma empresa
// POST   /api/companies                                  -> cria empresa
// POST   /api/companies { action: "create-branch", ... } -> cria filial
// PUT    /api/companies { id, ... }                      -> edita empresa
// PATCH  /api/companies { id, active }                   -> ativa/inativa empresa
//
// tenant_id NUNCA vem do corpo da requisição — é sempre derivado da sessão (regra #49).

const companySchema = z.object({
  legalName: z.string().min(2, "Informe a razão social."),
  tradeName: z.string().optional().default(""),
  cnpj: z.string().min(14, "CNPJ inválido."),
  stateRegistration: z.string().optional().default(""),
  taxRegime: z.enum(["simples_nacional", "lucro_presumido", "lucro_real", "mei"]),
  email: z.string().email().optional().or(z.literal("")).default(""),
  phone: z.string().optional().default(""),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  isMatrix: z.boolean().optional().default(true),
});

const branchSchema = z.object({
  companyId: z.string().uuid("Empresa inválida."),
  name: z.string().min(2, "Informe o nome da filial."),
  code: z.string().min(1, "Informe o código da filial."),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await resolveSession(req);

    if (req.method === "GET") {
      const action = String(req.query.action ?? "");
      if (action === "branches") return await listBranches(req, res, session.tenantId);
      requirePermission(session, "companies", "view");
      return await listCompanies(req, res, session.tenantId);
    }

    if (req.method === "POST") {
      const action = String(req.body?.action ?? "");
      if (action === "create-branch") {
        requirePermission(session, "branches", "create");
        return await createBranch(req, res, session);
      }
      requirePermission(session, "companies", "create");
      return await createCompany(req, res, session);
    }

    if (req.method === "PUT") {
      requirePermission(session, "companies", "edit");
      return await updateCompany(req, res, session);
    }

    if (req.method === "PATCH") {
      requirePermission(session, "companies", "edit");
      return await toggleCompanyActive(req, res, session);
    }

    throw badRequest("Método não suportado.");
  } catch (err) {
    sendError(res, err);
  }
}

function mapCompanyRow(row: Record<string, unknown>): Company {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    legalName: row.legal_name as string,
    tradeName: (row.trade_name as string) ?? "",
    cnpj: row.cnpj as string,
    stateRegistration: (row.state_registration as string) ?? null,
    municipalRegistration: (row.municipal_registration as string) ?? null,
    taxRegime: row.tax_regime as Company["taxRegime"],
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
    addressLine: (row.address_line as string) ?? null,
    zipCode: (row.zip_code as string) ?? null,
    city: (row.city as string) ?? null,
    state: (row.state as string) ?? null,
    country: (row.country as string) ?? "BR",
    logoUrl: (row.logo_url as string) ?? null,
    isMatrix: Boolean(row.is_matrix),
    active: Boolean(row.active),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapBranchRow(row: Record<string, unknown>): Branch {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    code: row.code as string,
    cnpj: (row.cnpj as string) ?? null,
    addressLine: (row.address_line as string) ?? null,
    city: (row.city as string) ?? null,
    state: (row.state as string) ?? null,
    zipCode: (row.zip_code as string) ?? null,
    phone: (row.phone as string) ?? null,
    active: Boolean(row.active),
    createdAt: row.created_at as string,
  };
}

async function listCompanies(req: VercelRequest, res: VercelResponse, tenantId: string) {
  const search = String(req.query.search ?? "").trim();
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
  const offset = (page - 1) * pageSize;

  const searchClause = search ? `AND (legal_name LIKE ? OR trade_name LIKE ? OR cnpj LIKE ?)` : "";
  const searchArgs = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];

  const rows = await query(
    `SELECT * FROM companies WHERE tenant_id = ? ${searchClause}
     ORDER BY is_matrix DESC, legal_name ASC LIMIT ? OFFSET ?`,
    [tenantId, ...searchArgs, pageSize, offset]
  );
  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*) as total FROM companies WHERE tenant_id = ? ${searchClause}`,
    [tenantId, ...searchArgs]
  );

  const payload: Paginated<Company> = {
    items: rows.map(mapCompanyRow),
    total: countRow?.total ?? 0,
    page,
    pageSize,
  };
  sendJson(res, 200, payload);
}

async function listBranches(req: VercelRequest, res: VercelResponse, tenantId: string) {
  const companyId = String(req.query.companyId ?? "");

  if (!companyId) {
    // Sem companyId: retorna todas as filiais do tenant (usado por seletores
    // de filial em outros módulos, ex: estoque).
    const rows = await query(
      `SELECT b.*, c.trade_name as company_trade_name, c.legal_name as company_legal_name
       FROM branches b JOIN companies c ON c.id = b.company_id
       WHERE b.tenant_id = ? ORDER BY c.is_matrix DESC, b.name ASC`,
      [tenantId]
    );
    const payload: Paginated<Branch & { companyName?: string }> = {
      items: rows.map((r) => ({
        ...mapBranchRow(r),
        companyName: (r.company_trade_name as string) || (r.company_legal_name as string),
      })),
      total: rows.length,
      page: 1,
      pageSize: rows.length,
    };
    return sendJson(res, 200, payload);
  }

  const company = await queryOne(`SELECT id FROM companies WHERE id = ? AND tenant_id = ?`, [
    companyId,
    tenantId,
  ]);
  if (!company) throw notFound("Empresa não encontrada.");

  const rows = await query(`SELECT * FROM branches WHERE company_id = ? ORDER BY name ASC`, [companyId]);
  const payload: Paginated<Branch> = {
    items: rows.map(mapBranchRow),
    total: rows.length,
    page: 1,
    pageSize: rows.length,
  };
  sendJson(res, 200, payload);
}

async function createCompany(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const parsed = companySchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const data = parsed.data;

  const digits = data.cnpj.replace(/\D/g, "");
  const existing = await queryOne(`SELECT id FROM companies WHERE tenant_id = ? AND cnpj = ?`, [
    session.tenantId,
    digits,
  ]);
  if (existing) throw conflict("Já existe uma empresa cadastrada com este CNPJ.");

  const id = uuid();
  await exec(
    `INSERT INTO companies
      (id, tenant_id, legal_name, trade_name, cnpj, state_registration, tax_regime, email, phone, city, state, is_matrix)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      session.tenantId,
      data.legalName,
      data.tradeName || null,
      digits,
      data.stateRegistration || null,
      data.taxRegime,
      data.email || null,
      data.phone || null,
      data.city || null,
      data.state || null,
      data.isMatrix ? 1 : 0,
    ]
  );

  // A matriz sempre ganha uma filial "principal" (código 001) para que estoque,
  // vendas e demais módulos já tenham onde operar.
  await exec(
    `INSERT INTO branches (id, tenant_id, company_id, name, code, city, state)
     VALUES (?, ?, ?, ?, '001', ?, ?)`,
    [uuid(), session.tenantId, id, data.tradeName || data.legalName, data.city || null, data.state || null]
  );

  await recordAudit(session, {
    module: "companies",
    action: "create",
    recordId: id,
    description: `Empresa "${data.legalName}" cadastrada.`,
    newValue: data,
  });

  const row = await queryOne(`SELECT * FROM companies WHERE id = ?`, [id]);
  sendJson(res, 201, mapCompanyRow(row!));
}

async function updateCompany(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const id = String(req.body?.id ?? "");
  if (!id) throw badRequest("Informe a empresa a ser editada.");

  const current = await queryOne(`SELECT * FROM companies WHERE id = ? AND tenant_id = ?`, [
    id,
    session.tenantId,
  ]);
  if (!current) throw notFound("Empresa não encontrada.");

  const parsed = companySchema.partial().safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const data = parsed.data;

  await exec(
    `UPDATE companies SET
      legal_name = COALESCE(?, legal_name),
      trade_name = COALESCE(?, trade_name),
      state_registration = COALESCE(?, state_registration),
      tax_regime = COALESCE(?, tax_regime),
      email = COALESCE(?, email),
      phone = COALESCE(?, phone),
      city = COALESCE(?, city),
      state = COALESCE(?, state),
      updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ?`,
    [
      data.legalName ?? null,
      data.tradeName ?? null,
      data.stateRegistration ?? null,
      data.taxRegime ?? null,
      data.email ?? null,
      data.phone ?? null,
      data.city ?? null,
      data.state ?? null,
      id,
      session.tenantId,
    ]
  );

  await recordAudit(session, {
    module: "companies",
    action: "edit",
    recordId: id,
    description: `Empresa "${current.legal_name}" atualizada.`,
    previousValue: current,
    newValue: data,
  });

  const row = await queryOne(`SELECT * FROM companies WHERE id = ?`, [id]);
  sendJson(res, 200, mapCompanyRow(row!));
}

async function toggleCompanyActive(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const id = String(req.body?.id ?? "");
  const active = Boolean(req.body?.active);
  if (!id) throw badRequest("Informe a empresa.");

  const current = await queryOne<{ legal_name: string }>(
    `SELECT legal_name FROM companies WHERE id = ? AND tenant_id = ?`,
    [id, session.tenantId]
  );
  if (!current) throw notFound("Empresa não encontrada.");

  await exec(`UPDATE companies SET active = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`, [
    active ? 1 : 0,
    id,
    session.tenantId,
  ]);

  await recordAudit(session, {
    module: "companies",
    action: active ? "activate" : "deactivate",
    recordId: id,
    description: `Empresa "${current.legal_name}" ${active ? "ativada" : "desativada"}.`,
  });

  sendJson(res, 200, { ok: true });
}

async function createBranch(req: VercelRequest, res: VercelResponse, session: ResolvedSession) {
  const parsed = branchSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Dados inválidos.", flattenZod(parsed.error));
  const data = parsed.data;

  const company = await queryOne(`SELECT id FROM companies WHERE id = ? AND tenant_id = ?`, [
    data.companyId,
    session.tenantId,
  ]);
  if (!company) throw notFound("Empresa não encontrada.");

  const existingCode = await queryOne(`SELECT id FROM branches WHERE company_id = ? AND code = ?`, [
    data.companyId,
    data.code,
  ]);
  if (existingCode) throw conflict("Já existe uma filial com este código nesta empresa.");

  const id = uuid();
  await exec(
    `INSERT INTO branches (id, tenant_id, company_id, name, code, city, state)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, session.tenantId, data.companyId, data.name, data.code, data.city || null, data.state || null]
  );

  await recordAudit(session, {
    module: "branches",
    action: "create",
    recordId: id,
    description: `Filial "${data.name}" cadastrada.`,
    newValue: data,
  });

  const row = await queryOne(`SELECT * FROM branches WHERE id = ?`, [id]);
  sendJson(res, 201, mapBranchRow(row!));
}

function flattenZod(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fields[key] = issue.message;
  }
  return fields;
}
