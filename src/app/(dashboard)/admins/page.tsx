"use client";

import { useState, type FormEvent } from "react";
import { api, fmtDate } from "@/lib/api";
import { useAction, useApi } from "@/components/use-api";
import { useAdmin } from "@/components/admin-context";
import { ROLE_LABELS } from "@/components/status";
import { Badge, Button, Card, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Table, Td, Th } from "@/components/ui";

type Role = "ADMIN" | "STAFF" | "VIEWER";

interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLE_HELP: Record<Role, string> = {
  ADMIN: "Acesso total: configurações, reembolsos, administradores",
  STAFF: "Gerencia produtos, estoque e pedidos",
  VIEWER: "Somente leitura",
};

export default function AdminsPage() {
  const me = useAdmin();
  const { data, error, loading, reload } = useApi<{ items: AdminRow[] }>(me.role === "ADMIN" ? "/api/admin/admins" : null);
  const action = useAction();
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<AdminRow | null>(null);

  if (me.role !== "ADMIN") return <ErrorBox error="Apenas administradores podem acessar esta página." />;

  async function patch(a: AdminRow, body: Partial<{ role: Role; isActive: boolean; password: string }>, msg: string) {
    const r = await action.run(a.id, () => api(`/api/admin/admins/${a.id}`, { method: "PATCH", body }), msg);
    if (r) await reload();
    return r;
  }

  return (
    <>
      <PageHeader title="Administradores" subtitle="Níveis: ADMIN, STAFF e VIEWER" actions={<Button variant="primary" onClick={() => setCreating(true)}>+ Novo administrador</Button>} />
      {action.error && <div className="mb-3"><ErrorBox error={action.error} /></div>}
      {action.message && <div className="mb-3"><Notice>{action.message}</Notice></div>}
      <Card>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>E-mail</Th>
                <Th>Papel</Th>
                <Th>2FA</Th>
                <Th>Último login</Th>
                <Th>Status</Th>
                <Th>Ações</Th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((a) => {
                const self = a.id === me.id;
                return (
                  <tr key={a.id}>
                    <Td>
                      {a.name} {self && <Badge tone="accent">você</Badge>}
                    </Td>
                    <Td>{a.email}</Td>
                    <Td>
                      <select
                        className="input w-auto py-1"
                        value={a.role}
                        disabled={self || action.busy === a.id}
                        onChange={(e) => patch(a, { role: e.target.value as Role }, "Papel atualizado.")}
                      >
                        {(["ADMIN", "STAFF", "VIEWER"] as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </Td>
                    <Td>{a.totpEnabled ? <Badge tone="ok">ativo</Badge> : <Badge tone="warn">inativo</Badge>}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(a.lastLoginAt)}</Td>
                    <Td>{a.isActive ? <Badge tone="ok">ativo</Badge> : <Badge tone="bad">desativado</Badge>}</Td>
                    <Td>
                      <span className="flex gap-1">
                        {!self && (
                          <Button size="sm" onClick={() => patch(a, { isActive: !a.isActive }, a.isActive ? "Administrador desativado." : "Administrador reativado.")}>
                            {a.isActive ? "Desativar" : "Reativar"}
                          </Button>
                        )}
                        <Button size="sm" onClick={() => setResetFor(a)}>
                          Redefinir senha
                        </Button>
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="Novo administrador">
        <CreateAdminForm
          onDone={async () => {
            setCreating(false);
            await reload();
          }}
        />
      </Modal>
      <Modal open={resetFor !== null} onClose={() => setResetFor(null)} title={`Redefinir senha — ${resetFor?.email ?? ""}`}>
        {resetFor && (
          <ResetPasswordForm
            onSubmit={async (password) => {
              const r = await patch(resetFor, { password }, "Senha redefinida. As sessões desse administrador foram encerradas.");
              if (r) setResetFor(null);
            }}
            busy={action.busy === resetFor.id}
          />
        )}
      </Modal>
    </>
  );
}

function CreateAdminForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("STAFF");
  const action = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await action.run("create", () => api("/api/admin/admins", { method: "POST", body: { email, name, password, role } }));
    if (r) onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {action.error && <ErrorBox error={action.error} />}
      <Field label="Nome">
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="E-mail">
        <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Senha inicial" hint="Mín. 12 caracteres com maiúsculas, minúsculas e números">
        <input className="input" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Papel" hint={ROLE_HELP[role]}>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {(["ADMIN", "STAFF", "VIEWER"] as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      <Button variant="primary" type="submit" loading={action.busy === "create"}>
        Criar
      </Button>
    </form>
  );
}

function ResetPasswordForm({ onSubmit, busy }: { onSubmit: (password: string) => void; busy: boolean }) {
  const [password, setPassword] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(password);
      }}
    >
      <Field label="Nova senha" hint="Mín. 12 caracteres com maiúsculas, minúsculas e números">
        <input className="input" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button variant="primary" type="submit" loading={busy}>
        Redefinir
      </Button>
    </form>
  );
}
