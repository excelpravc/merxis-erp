import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Helpers compartilhados de autenticação/sessão.
// Prefixo "_" faz a Vercel ignorar este arquivo como rota.

const SESSION_COOKIE = "erp_session";
const BCRYPT_ROUNDS = 12;

export interface SessionTokenPayload {
  userId: string;
  tenantId: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET não configurada. Preencha o arquivo .env a partir de .env.example.");
  }
  return secret;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signSessionToken(payload: SessionTokenPayload): string {
  const minutes = Number(process.env.SESSION_EXPIRATION_MINUTES ?? 480);
  return jwt.sign(payload, getJwtSecret(), { expiresIn: `${minutes}m` });
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as SessionTokenPayload;
  } catch {
    return null;
  }
}

/** Define o cookie de sessão httpOnly (nunca acessível via JS no frontend). */
export function setSessionCookie(res: VercelResponse, token: string) {
  const minutes = Number(process.env.SESSION_EXPIRATION_MINUTES ?? 480);
  const secure = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${minutes * 60}; SameSite=Lax${secure ? "; Secure" : ""}`
  );
}

export function clearSessionCookie(res: VercelResponse) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

export function readSessionToken(req: VercelRequest): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return match ? match.slice(SESSION_COOKIE.length + 1) : null;
}
