import { createClient, type Client, type InArgs } from "@libsql/client";

// Cliente Turso compartilhado por todas as funções da API.
// Prefixo "_" no nome do arquivo faz a Vercel NÃO tratá-lo como uma rota.
//
// Credenciais NUNCA chegam ao frontend — este módulo só é importado
// dentro de /api.

let client: Client | null = null;

export function db(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL não configurada. Copie .env.example para .env e preencha as credenciais do Turso."
    );
  }

  client = createClient({ url, authToken });
  return client;
}

/** Executa uma query e retorna as linhas já como objetos simples. */
export async function query<T = Record<string, unknown>>(sql: string, args: InArgs = []): Promise<T[]> {
  const result = await db().execute({ sql, args });
  return result.rows as unknown as T[];
}

/** Executa uma query esperando no máximo uma linha de retorno. */
export async function queryOne<T = Record<string, unknown>>(sql: string, args: InArgs = []): Promise<T | null> {
  const rows = await query<T>(sql, args);
  return rows[0] ?? null;
}

/** Executa um INSERT/UPDATE/DELETE e retorna metadados da execução. */
export async function exec(sql: string, args: InArgs = []) {
  return db().execute({ sql, args });
}

/** Executa múltiplas instruções em uma transação (usado em fluxos críticos, ex: venda). */
export async function transaction(statements: { sql: string; args?: InArgs }[]) {
  const tx = await db().transaction("write");
  try {
    for (const stmt of statements) {
      await tx.execute({ sql: stmt.sql, args: stmt.args ?? [] });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}
