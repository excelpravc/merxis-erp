-- ============================================================
-- ERP Varejo SaaS — Schema Fase 1
-- Multi-tenant: tenants -> companies -> branches
-- Autenticação, RBAC (perfis/permissões) e auditoria
-- Compatível com Turso / libSQL (SQLite)
-- ============================================================

PRAGMA foreign_keys = ON;

-- --------------------------------------------------------------
-- Tenants (contas do SaaS) e planos
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id              TEXT PRIMARY KEY,
  key             TEXT NOT NULL UNIQUE,          -- 'basico' | 'profissional' | 'premium' | custom
  name            TEXT NOT NULL,
  max_users       INTEGER,                       -- NULL = ilimitado
  max_branches    INTEGER,                       -- NULL = ilimitado
  features        TEXT,                          -- JSON com flags de módulos habilitados
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tenants (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  plan_id               TEXT REFERENCES plans(id),
  subscription_status   TEXT NOT NULL DEFAULT 'trial'
                          CHECK (subscription_status IN ('trial','active','past_due','suspended','canceled')),
  trial_ends_at         TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id         TEXT NOT NULL REFERENCES plans(id),
  status          TEXT NOT NULL CHECK (status IN ('trial','active','past_due','suspended','canceled')),
  starts_at       TEXT NOT NULL DEFAULT (datetime('now')),
  ends_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);

-- --------------------------------------------------------------
-- Empresas e filiais
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legal_name              TEXT NOT NULL,
  trade_name              TEXT,
  cnpj                    TEXT NOT NULL,
  state_registration      TEXT,
  municipal_registration  TEXT,
  tax_regime              TEXT NOT NULL DEFAULT 'simples_nacional'
                            CHECK (tax_regime IN ('simples_nacional','lucro_presumido','lucro_real','mei')),
  email                   TEXT,
  phone                   TEXT,
  address_line            TEXT,
  zip_code                TEXT,
  city                    TEXT,
  state                   TEXT,
  country                 TEXT NOT NULL DEFAULT 'BR',
  logo_url                TEXT,
  is_matrix               INTEGER NOT NULL DEFAULT 1,
  active                  INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, cnpj)
);
CREATE INDEX IF NOT EXISTS idx_companies_tenant ON companies(tenant_id);

CREATE TABLE IF NOT EXISTS branches (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL,
  cnpj          TEXT,
  address_line  TEXT,
  city          TEXT,
  state         TEXT,
  zip_code      TEXT,
  phone         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_branches_company ON branches(company_id);

-- --------------------------------------------------------------
-- Usuários
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  email                   TEXT NOT NULL,
  password_hash           TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','blocked')),
  failed_login_attempts   INTEGER NOT NULL DEFAULT 0,
  locked_until            TEXT,
  last_login_at           TEXT,
  password_reset_token    TEXT,
  password_reset_expires  TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS user_branches (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id   TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, branch_id)
);

-- --------------------------------------------------------------
-- RBAC: perfis, permissões, vínculos
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = perfil global de sistema
  key             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  is_system_role  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);

CREATE TABLE IF NOT EXISTS permissions (
  id      TEXT PRIMARY KEY,
  module  TEXT NOT NULL,
  action  TEXT NOT NULL,
  UNIQUE (module, action)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id   TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  branch_id       TEXT REFERENCES branches(id) ON DELETE CASCADE, -- NULL = todas as filiais
  PRIMARY KEY (role_id, permission_id, branch_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id   TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- --------------------------------------------------------------
-- Auditoria
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  module          TEXT NOT NULL,
  action          TEXT NOT NULL,
  record_id       TEXT,
  description     TEXT NOT NULL,
  previous_value  TEXT, -- JSON
  new_value       TEXT, -- JSON
  ip_address      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module);

-- ============================================================
-- Fase 2 — Produtos, categorias, marcas, fornecedores, clientes, estoque
-- ============================================================

-- --------------------------------------------------------------
-- Categorias e marcas
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_categories (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES product_categories(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, name, parent_id)
);
CREATE INDEX IF NOT EXISTS idx_categories_tenant ON product_categories(tenant_id);

CREATE TABLE IF NOT EXISTS product_brands (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_brands_tenant ON product_brands(tenant_id);

-- --------------------------------------------------------------
-- Produtos
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku             TEXT NOT NULL,
  barcode         TEXT,
  name            TEXT NOT NULL,
  description     TEXT,
  category_id     TEXT REFERENCES product_categories(id) ON DELETE SET NULL,
  brand_id        TEXT REFERENCES product_brands(id) ON DELETE SET NULL,
  unit            TEXT NOT NULL DEFAULT 'UN',
  cost_price      REAL NOT NULL DEFAULT 0,
  sale_price      REAL NOT NULL DEFAULT 0,
  min_stock       REAL NOT NULL DEFAULT 0,
  max_stock       REAL,
  perishable      INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);

-- --------------------------------------------------------------
-- Fornecedores
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legal_name            TEXT NOT NULL,
  trade_name            TEXT,
  cnpj                  TEXT,
  state_registration    TEXT,
  phone                 TEXT,
  email                 TEXT,
  city                  TEXT,
  state                 TEXT,
  payment_terms         TEXT,
  active                INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id);

-- --------------------------------------------------------------
-- Clientes
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  document        TEXT,
  phone           TEXT,
  email           TEXT,
  city            TEXT,
  state           TEXT,
  credit_limit    REAL NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);

-- --------------------------------------------------------------
-- Estoque (posição atual por filial + histórico de movimentações)
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id           TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id          TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity            REAL NOT NULL DEFAULT 0,
  reserved_quantity   REAL NOT NULL DEFAULT 0,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (branch_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_tenant ON stock(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_branch ON stock(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_product ON stock(product_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id           TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id          TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type                TEXT NOT NULL CHECK (type IN
                        ('entry','exit','purchase','sale','return','transfer_in','transfer_out',
                         'adjustment','loss','damage','inventory')),
  quantity            REAL NOT NULL,
  previous_quantity   REAL NOT NULL,
  new_quantity        REAL NOT NULL,
  reference_type      TEXT,
  reference_id        TEXT,
  notes               TEXT,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stock_mov_tenant ON stock_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_branch ON stock_movements(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_created ON stock_movements(created_at);
