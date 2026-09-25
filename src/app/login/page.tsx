"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { Button, ErrorBox, Field } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("/api/admin/auth/login", {
        method: "POST",
        noRedirect: true,
        body: { email, password, ...(needs2fa ? { totp } : {}) },
      });
      window.location.href = "/";
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && (err.body as { requires2fa?: boolean } | null)?.requires2fa) {
        setNeeds2fa(true);
        setError(null);
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Muitas tentativas. Aguarde alguns minutos.");
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-card p-6">
        <div>
          <div className="text-2xl">🛒</div>
          <h1 className="mt-2 text-xl font-semibold">Painel da Loja</h1>
          <p className="text-sm text-muted">Acesso restrito a administradores.</p>
        </div>
        {error && <ErrorBox error={error} />}
        <Field label="E-mail">
          <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={needs2fa} />
        </Field>
        <Field label="Senha">
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={needs2fa} />
        </Field>
        {needs2fa && (
          <Field label="Código de verificação (2FA)" hint="Digite o código de 6 dígitos do seu app autenticador.">
            <input
              className="input tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
        )}
        <Button variant="primary" type="submit" loading={loading} className="w-full">
          {needs2fa ? "Verificar" : "Entrar"}
        </Button>
        {needs2fa && (
          <button type="button" className="w-full text-xs text-muted hover:text-fg" onClick={() => { setNeeds2fa(false); setTotp(""); }}>
            Voltar
          </button>
        )}
      </form>
    </main>
  );
}
