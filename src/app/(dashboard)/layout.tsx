"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  ChatCircleDots,
  CurrencyCircleDollar,
  Factory,
  GearSix,
  Key,
  List,
  Megaphone,
  Package,
  Receipt,
  ShieldCheck,
  SignOut,
  SquaresFour,
  Storefront,
  Tag,
  Users,
  Wallet,
  WebhooksLogo,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { useApi } from "@/components/use-api";
import { AdminContext, type AdminInfo } from "@/components/admin-context";
import { ROLE_LABELS } from "@/components/status";
import { cn, ErrorBox, PageSkeleton } from "@/components/ui";

interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  adminOnly?: boolean;
}

/** Sidebar grouped by job, so each page is found by what you want to do. */
const NAV: { group?: string; items: NavItem[] }[] = [
  { items: [{ href: "/", label: "Visão geral", icon: SquaresFour }] },
  {
    group: "Vendas",
    items: [
      { href: "/orders", label: "Pedidos", icon: Receipt },
      { href: "/customers", label: "Clientes", icon: Users },
      { href: "/deposits", label: "Depósitos", icon: Wallet },
      { href: "/profit", label: "Lucro", icon: CurrencyCircleDollar },
    ],
  },
  {
    group: "Catálogo",
    items: [
      { href: "/products", label: "Produtos", icon: Tag },
      { href: "/inventory", label: "Estoque", icon: Package },
      { href: "/supplier", label: "Fornecedor", icon: Factory },
    ],
  },
  {
    group: "Atendimento",
    items: [
      { href: "/support", label: "Suporte", icon: ChatCircleDots },
      { href: "/broadcast", label: "Aviso geral", icon: Megaphone, adminOnly: true },
    ],
  },
  {
    group: "Sistema",
    items: [
      { href: "/settings", label: "Configurações", icon: GearSix },
      { href: "/admins", label: "Administradores", icon: Key, adminOnly: true },
      { href: "/audit", label: "Auditoria", icon: ShieldCheck },
      { href: "/webhooks", label: "Webhooks", icon: WebhooksLogo },
    ],
  },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

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
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageSkeleton />
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
  let index = 0;

  return (
    <AdminContext.Provider value={{ admin, reload: me.reload }}>
      <a
        href="#conteudo"
        className="fixed left-4 top-4 z-[60] -translate-y-24 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg transition focus:translate-y-0"
      >
        Pular para o conteúdo
      </a>

      <div className="min-h-screen lg:flex">
        {/* Mobile: compact bar floating off the top edge */}
        <header className="sticky top-0 z-[55] px-3 pt-3 lg:hidden">
          <div className="flex items-center justify-between rounded-2xl border border-line bg-card/80 px-3 py-2 backdrop-blur-xl">
            <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
              <Storefront size={20} weight="duotone" className="text-accent" />
              Painel da Loja
            </Link>
            <button
              onClick={() => setOpen((v) => !v)}
              className="relative flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-card-2 active:scale-[0.98]"
              aria-label={open ? "Fechar menu" : "Abrir menu"}
              aria-expanded={open}
            >
              <List size={20} className={cn("absolute transition duration-500", open ? "rotate-90 scale-50 opacity-0" : "opacity-100")} />
              <X size={20} className={cn("absolute transition duration-500", open ? "opacity-100" : "-rotate-90 scale-50 opacity-0")} />
            </button>
          </div>
        </header>

        <aside
          data-open={open}
          className={cn(
            "nav-panel fixed inset-0 z-50 flex flex-col bg-bg/95 pt-20 backdrop-blur-2xl transition duration-500 lg:sticky lg:inset-auto lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-r lg:border-line lg:bg-card lg:pt-0 lg:opacity-100 lg:backdrop-blur-none",
            open ? "visible opacity-100" : "invisible opacity-0 lg:visible",
          )}
        >
          <Link href="/" className="hidden items-center gap-2 px-6 py-6 text-base font-semibold lg:flex">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Storefront size={18} weight="duotone" />
            </span>
            Painel da Loja
          </Link>

          <nav aria-label="Navegação principal" className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
            {NAV.map((section, s) => {
              const items = section.items.filter((n) => !n.adminOnly || admin.role === "ADMIN");
              if (!items.length) return null;
              return (
                <div key={section.group ?? s}>
                  {section.group && <div className="mb-1 px-3 text-xs font-medium text-muted/80">{section.group}</div>}
                  <ul className="space-y-0.5">
                    {items.map((n) => {
                      const active = isActive(n.href);
                      const I = n.icon;
                      return (
                        <li key={n.href} className="nav-item" style={{ ["--i" as string]: index++ }}>
                          <Link
                            href={n.href}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-3 rounded-lg px-3 py-2 text-base transition lg:text-sm",
                              active ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-card-2 hover:text-fg",
                            )}
                          >
                            <I size={18} weight={active ? "fill" : "regular"} className="shrink-0" />
                            {n.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>

          <div className="nav-item border-t border-line p-3" style={{ ["--i" as string]: index }}>
            <Link
              href="/account"
              aria-current={isActive("/account") ? "page" : undefined}
              className={cn("flex items-center gap-3 rounded-lg p-2 transition hover:bg-card-2", isActive("/account") && "bg-card-2")}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">{initials(admin.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{admin.name}</span>
                <span className="block truncate text-xs text-muted">{ROLE_LABELS[admin.role]}</span>
              </span>
            </Link>
            <button
              onClick={logout}
              className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-card-2 hover:text-fg active:scale-[0.98]"
            >
              <SignOut size={18} />
              Sair
            </button>
          </div>
        </aside>

        <main id="conteudo" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </AdminContext.Provider>
  );
}
