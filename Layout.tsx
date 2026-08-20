import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Building2,
  Users as UsersIcon,
  ShieldCheck,
  Settings,
  LogOut,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "./auth";
import { usePermission } from "./permissions";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  show: boolean;
}

export default function Layout() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const { can, isSuperAdmin } = usePermission();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems: NavItem[] = [
    { to: "/", label: "Painel", icon: LayoutDashboard, show: true },
    {
      to: "/empresas",
      label: "Empresas e filiais",
      icon: Building2,
      show: can("companies", "view") || isSuperAdmin,
    },
    { to: "/usuarios", label: "Usuários", icon: UsersIcon, show: can("users", "view") || isSuperAdmin },
    { to: "/perfis", label: "Perfis e permissões", icon: ShieldCheck, show: can("roles", "view") || isSuperAdmin },
    { to: "/configuracoes", label: "Configurações", icon: Settings, show: can("settings", "view") || isSuperAdmin },
  ];

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const initials = (session?.user.name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex h-screen bg-canvas">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-ink-900 text-ink-100 lg:flex">
        <div className="flex h-16 items-center gap-2 px-6">
          <div className="h-2.5 w-2.5 rounded-sm bg-brass-400" />
          <span className="font-display text-base font-semibold tracking-tight text-white">
            ERP Varejo
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {navItems
            .filter((item) => item.show)
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-white/10 text-white"
                      : "text-ink-300 hover:bg-white/5 hover:text-white"
                  }`
                }
              >
                <item.icon size={17} />
                {item.label}
              </NavLink>
            ))}
        </nav>

        <div className="border-t border-white/10 px-4 py-4">
          <p className="truncate text-2xs font-medium uppercase tracking-wide text-ink-400">
            {session?.tenant.name}
          </p>
        </div>
      </aside>

      {/* Área principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-ledger bg-surface px-6">
          <div className="flex items-center gap-2 text-sm text-ink-400">
            <kbd className="rounded border border-ledger bg-canvas px-1.5 py-0.5 text-2xs text-ink-400">
              Ctrl K
            </kbd>
            <span>Buscar produtos, clientes, pedidos…</span>
          </div>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-ink-50"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-800 text-2xs font-semibold text-white">
                {initials}
              </div>
              <div className="hidden text-left sm:block">
                <p className="text-sm font-medium leading-tight text-ink-800">{session?.user.name}</p>
                <p className="text-2xs leading-tight text-ink-400">
                  {session?.roles.map((r) => r.name).join(", ")}
                </p>
              </div>
              <ChevronDown size={15} className="text-ink-400" />
            </button>

            {menuOpen && (
              <div className="animate-fade-in absolute right-0 top-full mt-2 w-48 rounded-lg border border-ledger bg-surface py-1 shadow-popover">
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-danger/5"
                >
                  <LogOut size={15} />
                  Sair
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
