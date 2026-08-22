import { v4 as uuid } from "uuid";
import { exec } from "./_db.js";
import type { ResolvedSession } from "./_tenant.js";

// Registro de auditoria centralizado. Chamado a partir das rotas sempre que
// uma operação sensível acontece (criar/editar/excluir empresa, usuário, permissões...).

export async function recordAudit(
  session: ResolvedSession,
  params: {
    module: string;
    action: string;
    recordId?: string | null;
    description: string;
    previousValue?: unknown;
    newValue?: unknown;
  }
) {
  await exec(
    `INSERT INTO audit_logs
      (id, tenant_id, user_id, module, action, record_id, description, previous_value, new_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      uuid(),
      session.tenantId,
      session.userId,
      params.module,
      params.action,
      params.recordId ?? null,
      params.description,
      params.previousValue != null ? JSON.stringify(params.previousValue) : null,
      params.newValue != null ? JSON.stringify(params.newValue) : null,
    ]
  );
}
