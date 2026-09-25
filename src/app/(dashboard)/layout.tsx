"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/components/use-api";
import { AdminContext, type AdminInfo } from "@/components/admin-context";
import { ROLE_LABELS } from "@/components/status";
import { Button, cn, ErrorBox, Loading } from "@/components/ui";

const NAV: { href: string; label: string; icon: string; adminOnly?: boolean }[] = [
  { href: "/", label: "Visão geral", icon: "📊" },
  { href: "/products", label: "Produtos", icon: "🏷️" },
  { href: "/inventory", label: "Estoque", icon: "📦" },
  { href: "/orders", label: "Pedidos", icon: "🧾" },
  { href: "/customers", label: "Clientes", icon: "👥" },
  { href: "/deposits", label: "Depósitos", icon: "👛" },
  { href: "/webhooks", label: "Webhooks", icon: "🔔" },
  { href: "/audit", label: "Auditoria", icon: "🛡️" },
  { href: "/settings", label: "Configurações", icon: "⚙️" },
  { href: "/admins", label: "Administradores", icon: "🔑", adminOnly: true },
  { href: "/account", label: "Minha conta", icon: "👤" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const me = useApi<{ admin: AdminInfo }>("/api/admin/auth/me");

  useEffect(() => setOpen(false), [pathname]);

  async function logout() {
    try {
      await api("/api/admin/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  if (me.loading && !me.data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading />
      </div>
    );
  }
  if (!me.data) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorBox error={me.error ?? "Não foi possível carregar a sessão"} onRetry={me.reload} />
      </div>
    );
  }
  const admin = me.data.admin;
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <AdminContext.Provider value={{ admin, reload: me.reload }}>
      <div className="min-h-screen lg:flex">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-card px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md border border-line px-2.5 py-1 text-sm" aria-label="Abrir menu">
            ☰
          </button>
          <span className="font-semibold">Painel da Loja</span>
          <span className="w-8" />
        </header>

        {open && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-card transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between px-5 py-4">
            <Link href="/" className="text-lg font-semibold">
              🛒 Painel da Loja
            </Link>
            <button className="text-muted lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
              ✕
            </button>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
            {NAV.filter((n) => !n.adminOnly || admin.role === "ADMIN").map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  isActive(n.href) ? "bg-accent/15 font-medium text-accent" : "text-muted hover:bg-card-2 hover:text-fg",
                )}
              >
                <span aria-hidden>{n.icon}</span>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-line p-4">
            <div className="truncate text-sm font-medium">{admin.name}</div>
            <div className="truncate text-xs text-muted">
              {admin.email} · {ROLE_LABELS[admin.role]}
            </div>
            <Button size="sm" className="mt-3 w-full" onClick={logout}>
              Sair
            </Button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </AdminContext.Provider>
  );
}
