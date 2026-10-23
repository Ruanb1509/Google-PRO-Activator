"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { prepareImage, type Attachment } from "@/lib/image-upload";
import { useAction, useApi } from "@/components/use-api";
import { useAdmin } from "@/components/admin-context";
import { Button, Card, ErrorBox, Loading, Notice, PageHeader } from "@/components/ui";

const MAX_LENGTH = 3500;

interface Audience {
  recipients: number;
  portuguese: number;
  english: number;
}

/** General announcement: one message (text, optional English version and image) to every customer in the bot. */
export default function BroadcastPage() {
  const me = useAdmin();
  const audience = useApi<Audience>(me.role === "ADMIN" ? "/api/admin/broadcast" : null);
  const action = useAction();
  const [textPt, setTextPt] = useState("");
  const [textEn, setTextEn] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (attachment) URL.revokeObjectURL(attachment.previewUrl);
  }, [attachment]);

  if (me.role !== "ADMIN") return <ErrorBox error="Apenas administradores podem enviar avisos gerais." />;

  async function attach(file: File | undefined | null) {
    if (!file) return;
    try {
      setAttachment(await prepareImage(file));
    } catch (err) {
      action.setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function send() {
    const pt = textPt.trim();
    if (!pt) return action.setError("Escreva a mensagem do aviso.");
    const total = audience.data?.recipients ?? 0;
    if (!confirm(`Enviar este aviso para ${total} cliente(s) no Telegram? Não dá para desfazer.`)) return;
    const image = attachment ? { contentType: attachment.contentType, base64: attachment.base64 } : undefined;
    const r = await action.run("send", () => api<{ recipients: number }>("/api/admin/broadcast", { method: "POST", body: { textPt: pt, textEn: textEn.trim() || undefined, image } }));
    if (!r) return;
    action.setMessage(`Enviando para ${r.recipients} cliente(s). Você recebe um resumo no Telegram de avisos quando terminar.`);
    setTextPt("");
    setTextEn("");
    setAttachment(null);
  }

  return (
    <>
      <PageHeader title="📢 Aviso geral" subtitle="Manda uma mensagem no bot para todos os clientes do Telegram" />
      {action.error && <div className="mb-3"><ErrorBox error={action.error} /></div>}
      {action.message && <div className="mb-3"><Notice>{action.message}</Notice></div>}

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card title="Mensagem">
          <div className="space-y-3">
            <label className="block">
              <span className="label">Texto em português (obrigatório)</span>
              <textarea className="input min-h-36" maxLength={MAX_LENGTH} placeholder="Ex.: Estoque reabastecido! Confira os produtos no menu." value={textPt} onChange={(e) => setTextPt(e.target.value)} />
              <span className="text-xs text-muted">{textPt.length}/{MAX_LENGTH}</span>
            </label>
            <label className="block">
              <span className="label">Texto em inglês (opcional)</span>
              <textarea className="input min-h-28" maxLength={MAX_LENGTH} placeholder="Se ficar vazio, quem usa o bot em inglês recebe o texto em português." value={textEn} onChange={(e) => setTextEn(e.target.value)} />
            </label>

            {attachment && (
              <div className="flex items-start gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachment.previewUrl} alt="Imagem do aviso" className="max-h-40 rounded-lg border border-line" />
                <button type="button" onClick={() => setAttachment(null)} className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-fg">
                  Remover
                </button>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void attach(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button onClick={() => fileRef.current?.click()} disabled={action.busy === "send"}>
                📎 {attachment ? "Trocar imagem" : "Anexar imagem"}
              </Button>
              <Button variant="primary" onClick={() => void send()} loading={action.busy === "send"} disabled={!textPt.trim() || !audience.data}>
                Enviar para {audience.data?.recipients ?? "…"} cliente(s)
              </Button>
            </div>
          </div>
        </Card>

        <Card title="Quem recebe">
          {audience.loading && !audience.data ? (
            <Loading />
          ) : audience.error ? (
            <ErrorBox error={audience.error} onRetry={audience.reload} />
          ) : (
            audience.data && (
              <div className="space-y-2 text-sm">
                <p>
                  <b>{audience.data.recipients}</b> cliente(s) no total
                </p>
                <p className="text-muted">🇧🇷 {audience.data.portuguese} em português · 🇺🇸 {audience.data.english} em inglês</p>
                <p className="text-xs text-muted">Clientes bloqueados no painel não recebem. Quem bloqueou o bot também não — o resumo no Telegram mostra quantos foram.</p>
              </div>
            )
          )}
        </Card>
      </div>
    </>
  );
}
