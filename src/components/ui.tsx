"use client";

import Link from "next/link";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn("rounded-xl border border-line bg-card p-4 sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-line bg-card-2 hover:border-accent",
  danger: "bg-bad text-white hover:opacity-90",
  ghost: "hover:bg-card-2",
};

function buttonClass(variant: Variant, size: "sm" | "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
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
    <button {...rest} disabled={disabled || loading} className={buttonClass(variant, size, className)}>
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "accent";

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-card-2 text-muted border-line",
    ok: "bg-ok/15 text-ok border-ok/30",
    warn: "bg-warn/15 text-warn border-warn/30",
    bad: "bg-bad/15 text-bad border-bad/30",
    info: "bg-info/15 text-info border-info/30",
    accent: "bg-accent/15 text-accent border-accent/30",
  };
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span aria-hidden className={cn("inline-block animate-spin rounded-full border-2 border-current border-t-transparent", small ? "h-3 w-3" : "h-5 w-5")} />;
}

export function Loading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad" role="alert">
      <span>{error}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = "ok", children }: { tone?: "ok" | "bad" | "warn" | "info"; children: ReactNode }) {
  const tones = { ok: "border-ok/40 bg-ok/10 text-ok", bad: "border-bad/40 bg-bad/10 text-bad", warn: "border-warn/40 bg-warn/10 text-warn", info: "border-info/40 bg-info/10 text-info" };
  return <div className={cn("rounded-lg border p-3 text-sm", tones[tone])}>{children}</div>;
}

export function Empty({ children = "Nada por aqui ainda." }: { children?: ReactNode }) {
  return <div className="py-10 text-center text-sm text-muted">{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted", className)}>{children}</th>;
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-line/60 px-3 py-2 align-middle", className)}>
      {children}
    </td>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex items-center justify-between gap-2 text-sm text-muted">
      <span>
        {total} registro{total === 1 ? "" : "s"} · página {page} de {pages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ← Anterior
        </Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Próxima →
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={cn("max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-card p-5 sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-muted hover:text-fg" aria-label="Fechar">
            ✕
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

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "bad" | "ok" }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "warn" && "text-warn", tone === "bad" && "text-bad", tone === "ok" && "text-ok")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
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
      <span className={cn("inline-block h-4 w-4 rounded-full bg-white transition", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

export function JsonView({ value }: { value: unknown }) {
  return <pre className="max-h-72 overflow-auto rounded-lg bg-card-2 p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>;
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
