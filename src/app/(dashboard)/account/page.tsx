"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAction } from "@/components/use-api";
import { useAdmin, useReloadAdmin } from "@/components/admin-context";
import { ROLE_LABELS } from "@/components/status";
import { Badge, Button, Card, ErrorBox, Field, Info, Notice, PageHeader } from "@/components/ui";

interface Setup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export default function AccountPage() {
  const admin = useAdmin();
  const reloadAdmin = useReloadAdmin();
  const pw = useAction();
  const tfa = useAction();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (next !== confirmPw) return pw.setError("As senhas não conferem.");
    const r = await pw.run("pw", () => api("/api/admin/auth/password", { method: "POST", body: { currentPassword: current, newPassword: next } }), "Senha alterada. Outras sessões foram encerradas.");
    if (r) {
      setCurrent("");
      setNext("");
      setConfirmPw("");
    }
  }

  async function startSetup() {
    const r = await tfa.run("setup", () => api<Setup>("/api/admin/auth/2fa/setup", { method: "POST" }));
    if (r) setSetup(r);
  }

  async function enable(e: FormEvent) {
    e.preventDefault();
    const r = await tfa.run("enable", () => api("/api/admin/auth/2fa/enable", { method: "POST", body: { code } }), "2FA ativado.");
    if (r) {
      setSetup(null);
      setCode("");
      reloadAdmin();
    }
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    const r = await tfa.run("disable", () => api("/api/admin/auth/2fa/disable", { method: "POST", body: { code } }), "2FA desativado.");
    if (r) {
      setCode("");
      reloadAdmin();
    }
  }

  const codeInput = (
    <Field label="Código de 6 dígitos">
      <input
        className="input tracking-[0.4em] sm:w-48"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        pattern="\d{6}"
        required
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
      />
    </Field>
  );

  return (
    <>
      <PageHeader title="Minha conta" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Perfil">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Info label="Nome" value={admin.name} />
            <Info label="E-mail" value={admin.email} />
            <Info label="Papel" value={ROLE_LABELS[admin.role]} />
            <Info label="2FA" value={admin.totpEnabled ? <Badge tone="ok">ativo</Badge> : <Badge tone="warn">inativo</Badge>} />
          </dl>
        </Card>

        <Card title="Autenticação em dois fatores (2FA)">
          {tfa.error && <div className="mb-3"><ErrorBox error={tfa.error} /></div>}
          {tfa.message && <div className="mb-3"><Notice>{tfa.message}</Notice></div>}
          {admin.totpEnabled ? (
            <form onSubmit={disable} className="space-y-3">
              <p className="text-sm text-muted">O 2FA está ativo. Para desativar, informe um código atual do seu app autenticador.</p>
              {codeInput}
              <Button type="submit" variant="danger" loading={tfa.busy === "disable"}>
                Desativar 2FA
              </Button>
            </form>
          ) : setup ? (
            <form onSubmit={enable} className="space-y-3">
              <p className="text-sm text-muted">Escaneie o QR code com Google Authenticator, Authy, 1Password etc. e digite o código gerado.</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qrDataUrl} alt="QR code do 2FA" width={220} height={220} className="rounded-lg bg-white p-2" />
              <div className="text-xs text-muted">
                Chave manual: <code className="break-all font-mono text-fg">{setup.secret}</code>
              </div>
              {codeInput}
              <Button type="submit" variant="primary" loading={tfa.busy === "enable"}>
                Ativar 2FA
              </Button>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted">Proteja sua conta exigindo um código do app autenticador no login.</p>
              <Button variant="primary" onClick={startSetup} loading={tfa.busy === "setup"}>
                Configurar 2FA
              </Button>
            </div>
          )}
        </Card>

        <Card title="Alterar senha">
          <form onSubmit={changePassword} className="space-y-3">
            {pw.error && <ErrorBox error={pw.error} />}
            {pw.message && <Notice>{pw.message}</Notice>}
            <Field label="Senha atual">
              <input className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="Nova senha" hint="Mín. 12 caracteres com maiúsculas, minúsculas e números">
              <input className="input" type="password" autoComplete="new-password" minLength={12} required value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Confirmar nova senha">
              <input className="input" type="password" autoComplete="new-password" minLength={12} required value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" loading={pw.busy === "pw"}>
              Alterar senha
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
