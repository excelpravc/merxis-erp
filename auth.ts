import { createContext, useContext } from "react";
import type { Session } from "./types";
import { api, ApiRequestError } from "./api";

export interface LoginResult {
  ok: boolean;
  errorMessage?: string;
}

export interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() precisa ser usado dentro de <AuthProvider>.");
  return ctx;
}

/** Busca a sessão atual (cookie httpOnly) resolvida pelo backend. Retorna null se não autenticado. */
export async function fetchSession(): Promise<Session | null> {
  try {
    return await api.get<Session>("/auth", { action: "session" });
  } catch (err) {
    if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) {
      return null;
    }
    throw err;
  }
}

export async function performLogin(email: string, password: string): Promise<LoginResult> {
  try {
    await api.post<{ ok: true }>("/auth", { action: "login", email, password });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return { ok: false, errorMessage: err.payload.message };
    }
    return { ok: false, errorMessage: "Não foi possível conectar ao servidor. Tente novamente." };
  }
}

export async function performLogout(): Promise<void> {
  await api.post("/auth", { action: "logout" });
}
