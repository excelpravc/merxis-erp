import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { v4 as uuid } from "uuid";
import { db, exec, queryOne } from "./_db";
import { hashPassword } from "./_auth";

// Script de migração/seed. Execução:
//   npm run migrate         -> aplica o schema.sql no banco Turso configurado em .env
//   npm run seed            -> aplica o schema.sql e cria dados iniciais (perfis, permissões, super admin)
//
// Este arquivo NÃO é exposto como endpoint (a Vercel ignora arquivos com
// prefixo "_" na pasta /api). Ele só roda localmente/CI via `tsx`.

const __dirname = dirname(fileURLToPath(import.meta.url));

const MODULES = [
  "dashboard",
  "companies",
  "branches",
  "users",
  "roles",
  "products",
  "stock",
  "purchases",
  "sales",
  "customers",
  "suppliers",
  "financial",
  "fiscal",
  "reports",
  "settings",
  "audit",
] as const;

const ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "cancel",
  "approve",
  "export",
  "print",
  "change_prices",
  "change_stock",
  "view_financial",
  "view_reports",
  "manage_users",
] as const;

const SYSTEM_ROLES: { key: string; name: string; description: string }[] = [
  { key: "super_admin", name: "Super Administrador", description: "Acesso total à plataforma SaaS." },
  { key: "company_admin", name: "Administrador da Empresa", description: "Acesso total dentro do tenant." },
  { key: "manager", name: "Gerente", description: "Gestão operacional geral." },
  { key: "supervisor", name: "Supervisor", description: "Supervisão de equipe e operações." },
  { key: "stock_clerk", name: "Estoquista", description: "Gestão de estoque e inventário." },
  { key: "buyer", name: "Comprador", description: "Gestão de compras e fornecedores." },
  { key: "salesperson", name: "Vendedor", description: "Registro de vendas e atendimento." },
  { key: "cashier", name: "Operador de Caixa", description: "Operação do PDV/caixa." },
  { key: "finance", name: "Financeiro", description: "Contas a pagar/receber e fluxo de caixa." },
  { key: "fiscal", name: "Fiscal", description: "Documentos fiscais e tributação." },
  { key: "accountant", name: "Contador", description: "Acesso a relatórios contábeis/fiscais." },
  { key: "auditor", name: "Auditor", description: "Acesso somente leitura a logs de auditoria." },
];

async function applySchema() {
  const schemaPath = join(__dirname, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  // libSQL não suporta múltiplas instruções em um único execute — separamos por ";".
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const statement of statements) {
    await exec(statement);
  }
  console.log(`✔ Schema aplicado (${statements.length} instruções).`);
}

async function seedPermissions() {
  for (const moduleKey of MODULES) {
    for (const action of ACTIONS) {
      const existing = await queryOne(`SELECT id FROM permissions WHERE module = ? AND action = ?`, [
        moduleKey,
        action,
      ]);
      if (!existing) {
        await exec(`INSERT INTO permissions (id, module, action) VALUES (?, ?, ?)`, [uuid(), moduleKey, action]);
      }
    }
  }
  console.log("✔ Permissões base semeadas.");
}

async function seedSystemRoles() {
  for (const role of SYSTEM_ROLES) {
    const existing = await queryOne(`SELECT id FROM roles WHERE key = ? AND tenant_id IS NULL`, [role.key]);
    if (!existing) {
      await exec(
        `INSERT INTO roles (id, tenant_id, key, name, description, is_system_role) VALUES (?, NULL, ?, ?, ?, 1)`,
        [uuid(), role.key, role.name, role.description]
      );
    }
  }
  console.log("✔ Perfis de sistema semeados.");
}

// Concessão padrão de permissões por perfil de sistema — funciona como um
// "template" global. Tenants que precisarem de algo diferente devem criar
// um perfil personalizado (roles.tenant_id = <tenant>), que fica livre para
// ser customizado via tela de Perfis e Permissões sem afetar outras contas.
const SYSTEM_ROLE_GRANTS: Record<string, { modules: typeof MODULES[number][]; actions: typeof ACTIONS[number][] } | "all"> = {
  company_admin: "all",
  manager: {
    modules: ["dashboard", "companies", "branches", "users", "products", "stock", "purchases", "sales", "customers", "suppliers", "reports", "settings"],
    actions: ["view", "create", "edit", "export", "print", "view_reports", "view_financial"],
  },
  supervisor: {
    modules: ["dashboard", "products", "stock", "sales", "customers", "reports"],
    actions: ["view", "create", "edit", "export", "view_reports"],
  },
  stock_clerk: {
    modules: ["dashboard", "products", "stock"],
    actions: ["view", "create", "edit", "change_stock"],
  },
  buyer: {
    modules: ["dashboard", "products", "purchases", "suppliers", "reports"],
    actions: ["view", "create", "edit", "approve", "view_reports"],
  },
  salesperson: {
    modules: ["dashboard", "products", "sales", "customers"],
    actions: ["view", "create"],
  },
  cashier: {
    modules: ["dashboard", "sales", "customers"],
    actions: ["view", "create", "cancel"],
  },
  finance: {
    modules: ["dashboard", "financial", "reports"],
    actions: ["view", "create", "edit", "approve", "export", "view_financial", "view_reports"],
  },
  fiscal: {
    modules: ["dashboard", "fiscal", "reports"],
    actions: ["view", "create", "edit", "export", "view_reports"],
  },
  accountant: {
    modules: ["dashboard", "financial", "fiscal", "reports"],
    actions: ["view", "export", "view_financial", "view_reports"],
  },
  auditor: {
    modules: ["dashboard", "audit", "reports"],
    actions: ["view", "view_reports"],
  },
};

async function seedRolePermissions() {
  for (const [roleKey, grant] of Object.entries(SYSTEM_ROLE_GRANTS)) {
    const role = await queryOne<{ id: string }>(`SELECT id FROM roles WHERE key = ? AND tenant_id IS NULL`, [
      roleKey,
    ]);
    if (!role) continue;

    const combos =
      grant === "all"
        ? MODULES.flatMap((moduleKey) => ACTIONS.map((action) => ({ moduleKey, action })))
        : grant.modules.flatMap((moduleKey) => grant.actions.map((action) => ({ moduleKey, action })));

    for (const { moduleKey, action } of combos) {
      const permission = await queryOne<{ id: string }>(
        `SELECT id FROM permissions WHERE module = ? AND action = ?`,
        [moduleKey, action]
      );
      if (!permission) continue;
      const existing = await queryOne(
        `SELECT 1 as x FROM role_permissions WHERE role_id = ? AND permission_id = ? AND branch_id IS NULL`,
        [role.id, permission.id]
      );
      if (!existing) {
        await exec(`INSERT INTO role_permissions (role_id, permission_id, branch_id) VALUES (?, ?, NULL)`, [
          role.id,
          permission.id,
        ]);
      }
    }
  }
  console.log("✔ Permissões padrão atribuídas aos perfis de sistema.");
}

async function seedPlans() {
  const plans = [
    { key: "basico", name: "Básico", maxUsers: 3, maxBranches: 1 },
    { key: "profissional", name: "Profissional", maxUsers: 15, maxBranches: 5 },
    { key: "premium", name: "Premium", maxUsers: null, maxBranches: null },
  ];
  for (const plan of plans) {
    const existing = await queryOne(`SELECT id FROM plans WHERE key = ?`, [plan.key]);
    if (!existing) {
      await exec(`INSERT INTO plans (id, key, name, max_users, max_branches, features) VALUES (?, ?, ?, ?, ?, ?)`, [
        uuid(),
        plan.key,
        plan.name,
        plan.maxUsers,
        plan.maxBranches,
        JSON.stringify({}),
      ]);
    }
  }
  console.log("✔ Planos base semeados.");
}

async function seedDemoTenantAndSuperAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@demo.local";
  const existingUser = await queryOne(`SELECT id FROM users WHERE email = ?`, [email]);
  if (existingUser) {
    console.log("• Tenant de demonstração já existe — pulando.");
    return;
  }

  const tenantId = uuid();
  const basicPlan = await queryOne<{ id: string }>(`SELECT id FROM plans WHERE key = 'profissional'`);

  await exec(
    `INSERT INTO tenants (id, name, plan_id, subscription_status, trial_ends_at)
     VALUES (?, ?, ?, 'trial', datetime('now', '+14 days'))`,
    [tenantId, "Empresa Demonstração", basicPlan?.id ?? null]
  );

  const password = process.env.SEED_ADMIN_PASSWORD ?? uuid().slice(0, 12);
  const passwordHash = await hashPassword(password);

  const userId = uuid();
  await exec(
    `INSERT INTO users (id, tenant_id, name, email, password_hash, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    [userId, tenantId, "Super Administrador", email, passwordHash]
  );

  const superAdminRole = await queryOne<{ id: string }>(
    `SELECT id FROM roles WHERE key = 'super_admin' AND tenant_id IS NULL`
  );
  if (superAdminRole) {
    await exec(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [userId, superAdminRole.id]);
  }

  console.log("✔ Tenant de demonstração e super admin criados:");
  console.log(`   E-mail: ${email}`);
  console.log(`   Senha:  ${password}`);
  console.log("   ⚠ Troque esta senha imediatamente após o primeiro acesso.");
}

async function main() {
  const seed = process.argv.includes("--seed");

  console.log("→ Aplicando schema no banco Turso…");
  await applySchema();

  if (seed) {
    console.log("→ Semeando dados iniciais…");
    await seedPermissions();
    await seedSystemRoles();
    await seedRolePermissions();
    await seedPlans();
    await seedDemoTenantAndSuperAdmin();
  }

  console.log("✔ Concluído.");
  process.exit(0);
}

main().catch((err) => {
  console.error("✘ Falha na migração:", err);
  process.exit(1);
});
