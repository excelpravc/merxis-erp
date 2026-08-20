import { useEffect, useState } from "react";
import { Building2, Users as UsersIcon, ShieldCheck, ArrowRight, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import type { Paginated, Company, User } from "./types";

export default function Dashboard() {
  const { session } = useAuth();
  const [companyCount, setCompanyCount] = useState<number | null>(null);
  const [userCount, setUserCount] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [companies, users] = await Promise.all([
          api.get<Paginated<Company>>("/companies", { page: 1, pageSize: 1 }),
          api.get<Paginated<User>>("/users", { page: 1, pageSize: 1 }),
        ]);
        if (mounted) {
          setCompanyCount(companies.total);
          setUserCount(users.total);
        }
      } catch {
        // Painel segue funcional mesmo se um card falhar — sem dado fica "—".
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const firstName = session?.user.name?.split(" ")[0] ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink-800">Olá, {firstName}</h1>
        <p className="mt-1 text-sm text-ink-400">
          Aqui está um resumo da sua conta em <span className="font-medium text-ink-600">{session?.tenant.name}</span>.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard
          icon={Building2}
          label="Empresas cadastradas"
          value={companyCount}
          to="/empresas"
        />
        <SummaryCard icon={UsersIcon} label="Usuários ativos" value={userCount} to="/usuarios" />
        <SummaryCard
          icon={ShieldCheck}
          label="Seu plano"
          value={session?.tenant.subscriptionStatus === "trial" ? "Período de teste" : "Ativo"}
          to="/configuracoes"
        />
      </div>

      <div className="card p-6">
        <h2 className="font-display text-base font-semibold text-ink-800">Próximos módulos</h2>
        <p className="mt-1 text-sm text-ink-400">
          Estoque, PDV, compras, financeiro, fiscal e relatórios chegam nas próximas fases —
          a fundação de autenticação, empresas e permissões já está pronta para recebê-los.
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-2 text-sm text-ink-600 sm:grid-cols-2">
          {[
            "Produtos, categorias e estoque",
            "Compras e entrada de NF-e",
            "Vendas e PDV",
            "Financeiro e fluxo de caixa",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2 rounded-lg border border-dashed border-ledger px-3 py-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ink-200" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  to,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string | null;
  to: string;
}) {
  return (
    <Link to={to} className="card group flex flex-col gap-3 p-5 transition-shadow hover:shadow-popover">
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-50 text-ink-600">
          <Icon size={18} />
        </div>
        <ArrowRight size={15} className="text-ink-300 transition-transform group-hover:translate-x-0.5" />
      </div>
      <div>
        <p className="tabular font-display text-2xl font-semibold text-ink-800">
          {value === null ? "—" : value}
        </p>
        <p className="text-sm text-ink-400">{label}</p>
      </div>
    </Link>
  );
}
