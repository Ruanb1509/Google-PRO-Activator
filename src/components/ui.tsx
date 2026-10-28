"use client";

import Link from "next/link";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ArrowRight, CaretLeft, CaretRight, Tray, WarningCircle, X, type Icon } from "@phosphor-icons/react";

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  title,
  description,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border border-line bg-card p-4 sm:p-6", className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Heading that splits a page into named groups ("Hoje", "Catálogo"…). */
export function SectionTitle({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Small "see more" link used in card headers. */
export function MoreLink({ href, children = "Ver detalhes" }: { href: string; children?: ReactNode }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-1 rounded-md text-sm font-medium text-accent transition hover:opacity-80">
      {children}
      <ArrowRight size={14} weight="bold" className="transition-transform duration-500 group-hover:translate-x-0.5" />
    </Link>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent/90",
  secondary: "border border-line bg-card-2 hover:border-muted/50 hover:bg-line",
  danger: "bg-bad text-white hover:bg-bad/90",
  ghost: "text-muted hover:bg-card-2 hover:text-fg",
};

function buttonClass(variant: Variant, size: "sm" | "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "rounded-md px-2 py-1 text-xs" : "rounded-lg px-3 py-2 text-sm",
    VARIANTS[variant],
    className,
  );
}

/** A link styled as a button. */
export function LinkButton({ href, variant = "secondary", size = "md", className, children }: { href: string; variant?: Variant; size?: "sm" | "md"; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button {...rest} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)}>
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "accent";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-info",
  accent: "text-accent",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-card-2 border-line",
    ok: "bg-ok/10 border-ok/25",
    warn: "bg-warn/10 border-warn/25",
    bad: "bg-bad/10 border-bad/25",
    info: "bg-info/10 border-info/25",
    accent: "bg-accent/10 border-accent/25",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone], TONE_TEXT[tone], className)}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Inline activity indicator for buttons. Page and list loads use skeletons instead. */
export function Spinner({ small }: { small?: boolean }) {
  return <span aria-hidden className={cn("inline-block animate-spin rounded-full border-2 border-current border-t-transparent", small ? "h-3 w-3" : "h-4 w-4")} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

/** Skeleton rows shaped like a list or table; works inside cards and as a page placeholder. */
export function Loading({ label = "Carregando…", rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-3 py-4" role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <Skeleton className={cn("h-4", i % 2 ? "w-1/2" : "w-3/4")} />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Page placeholder mirroring a header, a row of stat tiles and two panels. */
export function PageSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Carregando…</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad" role="alert">
      <span className="flex items-center gap-2">
        <WarningCircle size={18} weight="fill" className="shrink-0" />
        {error}
      </span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = "ok", children }: { tone?: "ok" | "bad" | "warn" | "info"; children: ReactNode }) {
  const tones = { ok: "border-ok/30 bg-ok/10 text-ok", bad: "border-bad/30 bg-bad/10 text-bad", warn: "border-warn/30 bg-warn/10 text-warn", info: "border-info/30 bg-info/10 text-info" };
  return <div className={cn("rounded-xl border p-3 text-sm", tones[tone])}>{children}</div>;
}

export function Empty({ children = "Nada por aqui ainda.", icon: IconCmp = Tray }: { children?: ReactNode; icon?: Icon }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-card-2 text-muted">
        <IconCmp size={24} />
      </span>
      <p className="max-w-sm text-sm text-muted">{children}</p>
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-card-2/60">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("border-b border-line px-3 py-2 text-xs font-medium text-muted", className)}>{children}</th>;
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-line/60 px-3 py-3 align-middle", className)}>
      {children}
    </td>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
      <span className="tabular-nums">
        {total} registro{total === 1 ? "" : "s"} · página {page} de {pages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <CaretLeft size={12} weight="bold" /> Anterior
        </Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Próxima <CaretRight size={12} weight="bold" />
        </Button>
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={cn("max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-card p-6 shadow-2xl sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted transition hover:bg-card-2 hover:text-fg" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** KPI tile. With `href` the whole tile becomes a link to the page that explains the number. */
export function Stat({
  label,
  value,
  hint,
  tone,
  icon: IconCmp,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "warn" | "bad" | "ok";
  icon?: Icon;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted">{label}</span>
        {IconCmp && (
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card-2", tone ? TONE_TEXT[tone] : "text-muted")}>
            <IconCmp size={16} weight="duotone" />
          </span>
        )}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", tone && TONE_TEXT[tone])}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </>
  );
  const base = "block rounded-2xl border border-line bg-card p-4";
  if (!href) return <div className={base}>{body}</div>;
  return (
    <Link href={href} className={cn(base, "transition hover:-translate-y-0.5 hover:border-muted/40 active:scale-[0.98]")}>
      {body}
    </Link>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50", checked ? "bg-ok" : "bg-line")}
    >
      <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-500", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

export function JsonView({ value }: { value: unknown }) {
  return <pre className="max-h-72 overflow-auto rounded-lg bg-card-2 p-3 font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

/** Label/value pair for detail views (use inside a <dl>). */
export function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
