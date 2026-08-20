// Tipos compartilhados do domínio — Fase 1
// (tenant/empresa/filial, usuários, perfis e permissões)

export type UUID = string;

export type SubscriptionStatus = "trial" | "active" | "past_due" | "suspended" | "canceled";

export interface Tenant {
  id: UUID;
  name: string;
  planId: string | null;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  createdAt: string;
}

export type TaxRegime = "simples_nacional" | "lucro_presumido" | "lucro_real" | "mei";

export interface Company {
  id: UUID;
  tenantId: UUID;
  legalName: string; // razão social
  tradeName: string; // nome fantasia
  cnpj: string;
  stateRegistration: string | null; // inscrição estadual
  municipalRegistration: string | null; // inscrição municipal
  taxRegime: TaxRegime;
  email: string | null;
  phone: string | null;
  addressLine: string | null;
  zipCode: string | null;
  city: string | null;
  state: string | null;
  country: string;
  logoUrl: string | null;
  isMatrix: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: UUID;
  tenantId: UUID;
  companyId: UUID;
  name: string;
  code: string; // código curto da filial, ex: "001"
  cnpj: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  active: boolean;
  createdAt: string;
}

export type SystemRoleKey =
  | "super_admin"
  | "company_admin"
  | "manager"
  | "supervisor"
  | "stock_clerk"
  | "buyer"
  | "salesperson"
  | "cashier"
  | "finance"
  | "fiscal"
  | "accountant"
  | "auditor"
  | "custom";

export interface Role {
  id: UUID;
  tenantId: UUID | null; // null = perfil de sistema (global), preenchido = perfil customizado do tenant
  key: SystemRoleKey;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  createdAt: string;
}

export type PermissionAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "cancel"
  | "approve"
  | "export"
  | "print"
  | "change_prices"
  | "change_stock"
  | "view_financial"
  | "view_reports"
  | "manage_users";

export type PermissionModule =
  | "dashboard"
  | "companies"
  | "branches"
  | "users"
  | "roles"
  | "products"
  | "stock"
  | "purchases"
  | "sales"
  | "customers"
  | "suppliers"
  | "financial"
  | "fiscal"
  | "reports"
  | "settings"
  | "audit";

export interface Permission {
  id: UUID;
  module: PermissionModule;
  action: PermissionAction;
}

export interface RolePermission {
  roleId: UUID;
  permissionId: UUID;
  branchId: UUID | null; // permissão restrita a uma filial específica, quando aplicável
}

export type UserStatus = "active" | "inactive" | "blocked";

export interface User {
  id: UUID;
  tenantId: UUID;
  name: string;
  email: string;
  status: UserStatus;
  roleIds: UUID[];
  branchIds: UUID[]; // filiais às quais o usuário tem acesso
  lastLoginAt: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
}

export interface Session {
  user: Pick<User, "id" | "tenantId" | "name" | "email" | "status">;
  tenant: Pick<Tenant, "id" | "name" | "subscriptionStatus">;
  roles: Pick<Role, "id" | "key" | "name">[];
  permissions: string[]; // formato "module:action", já achatado para consumo rápido no frontend
  branchIds: UUID[];
  isSuperAdmin: boolean;
}

export interface ApiError {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
