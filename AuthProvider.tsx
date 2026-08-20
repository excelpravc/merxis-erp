import { useCallback, useEffect, useState } from "react";
import type { Session } from "./types";
import { AuthContext, fetchSession, performLogin, performLogout } from "./auth";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const s = await fetchSession();
    setSession(s);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const s = await fetchSession();
      if (mounted) {
        setSession(s);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await performLogin(email, password);
    if (result.ok) {
      const s = await fetchSession();
      setSession(s);
    }
    return result;
  }, []);

  const logout = useCallback(async () => {
    await performLogout();
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
