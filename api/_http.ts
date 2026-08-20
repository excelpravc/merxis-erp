import type { VercelResponse } from "@vercel/node";

// Helpers de resposta HTTP consistentes para todas as rotas de /api.
// Nunca vazam stack trace, SQL ou credenciais ao cliente (regra #50 do briefing).

export class HttpError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function badRequest(message: string, fields?: Record<string, string>) {
  return new HttpError(400, "bad_request", message, fields);
}
export function unauthorized(message = "Sessão inválida ou expirada. Faça login novamente.") {
  return new HttpError(401, "unauthorized", message);
}
export function forbidden(message = "Você não tem permissão para realizar esta ação.") {
  return new HttpError(403, "forbidden", message);
}
export function notFound(message = "Registro não encontrado.") {
  return new HttpError(404, "not_found", message);
}
export function conflict(message: string) {
  return new HttpError(409, "conflict", message);
}

export function sendJson(res: VercelResponse, status: number, payload: unknown) {
  res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(payload));
}

export function sendError(res: VercelResponse, err: unknown) {
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: err.code, message: err.message, fields: err.fields });
    return;
  }
  // Erro inesperado: log técnico no servidor, mensagem genérica para o cliente.
  // eslint-disable-next-line no-console
  console.error("[api] erro não tratado:", err);
  sendJson(res, 500, {
    error: "internal_error",
    message: "Ocorreu um erro inesperado. Tente novamente em instantes.",
  });
}
