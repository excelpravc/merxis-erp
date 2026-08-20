import { useAuth } from "./auth";

export default function SettingsPage() {
  const { session } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink-800">Configurações</h1>
        <p className="mt-1 text-sm text-ink-400">
          Preferências gerais da conta <span className="font-medium text-ink-600">{session?.tenant.name}</span>.
        </p>
      </div>

      <div className="card p-6">
        <h2 className="font-display text-base font-semibold text-ink-800">Plano e assinatura</h2>
        <p className="mt-1 text-sm text-ink-400">
          Status atual:{" "}
          <span className="badge bg-brass-50 text-brass-700">
            {session?.tenant.subscriptionStatus === "trial" ? "Período de teste" : session?.tenant.subscriptionStatus}
          </span>
        </p>
      </div>

      <div className="card p-6">
        <h2 className="font-display text-base font-semibold text-ink-800">Próximas seções</h2>
        <p className="mt-1 text-sm text-ink-400">
          Moeda, fuso horário, alertas de estoque e validade, parâmetros fiscais e integrações
          serão adicionados nas próximas fases, junto aos módulos correspondentes.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-ink-500">
          {["Preferências do sistema", "Parâmetros de vendas e estoque", "Configurações fiscais", "Integrações externas"].map(
            (item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-ink-200" />
                {item}
              </li>
            )
          )}
        </ul>
      </div>
    </div>
  );
}
