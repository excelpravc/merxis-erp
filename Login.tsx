import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await login(email, password);
    setSubmitting(false);
    if (result.ok) {
      const from = (location.state as { from?: string })?.from ?? "/";
      navigate(from, { replace: true });
    } else {
      setError(result.errorMessage ?? "Não foi possível entrar. Verifique seus dados.");
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Lado esquerdo — identidade visual */}
      <div className="relative hidden overflow-hidden bg-ink-900 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 opacity-[0.07]">
          <div
            className="h-full w-full"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, transparent, transparent 27px, rgba(255,255,255,0.5) 28px)",
            }}
          />
        </div>

        <div className="relative z-10 font-display text-lg font-semibold tracking-tight text-white">
          ERP Varejo
        </div>

        <div className="relative z-10 max-w-md">
          {/* Cartão de "recibo" com linha de leitura animada — elemento de assinatura */}
          <div className="relative overflow-hidden rounded-xl2 border border-white/10 bg-white/[0.03] p-6 shadow-popover backdrop-blur-sm">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brass-400/70 to-transparent" />
            <div className="absolute inset-x-6 top-0 h-16 overflow-hidden">
              <div className="animate-scan h-full w-full bg-gradient-to-b from-transparent via-brass-400/40 to-transparent" />
            </div>
            <p className="tabular text-2xs uppercase tracking-[0.2em] text-brass-300">
              Fechamento de caixa · 001
            </p>
            <div className="mt-4 space-y-2">
              {[
                ["Vendas do dia", "R$ 18.420,90"],
                ["Ticket médio", "R$ 63,12"],
                ["Produtos vencendo", "12 itens"],
                ["Estoque baixo", "7 SKUs"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-ink-200">{label}</span>
                  <span className="tabular font-medium text-white">{value}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-6 text-sm leading-relaxed text-ink-200">
            Estoque, PDV, financeiro e fiscal de várias empresas em um único painel —
            com isolamento total entre clientes.
          </p>
        </div>

        <p className="relative z-10 text-xs text-ink-400">
          © {new Date().getFullYear()} ERP Varejo. Todos os direitos reservados.
        </p>
      </div>

      {/* Lado direito — formulário */}
      <div className="flex items-center justify-center bg-canvas px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="font-display text-lg font-semibold tracking-tight text-ink-800">
              ERP Varejo
            </span>
          </div>

          <h1 className="font-display text-2xl font-semibold text-ink-800">Entrar</h1>
          <p className="mt-1.5 text-sm text-ink-400">
            Acesse o painel de gestão da sua empresa.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label htmlFor="email" className="label">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                className="input"
                placeholder="voce@empresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="label">
                  Senha
                </label>
                <a href="/esqueci-senha" className="text-2xs font-medium text-brass-600 hover:underline">
                  Esqueci minha senha
                </a>
              </div>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger"
              >
                {error}
              </div>
            )}

            <button type="submit" disabled={submitting} className="btn-accent w-full">
              {submitting ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
