"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { AI_LOGOS, aiLogoSvg, findAiLogo } from "@/lib/ai-logos";
import { Button } from "@/components/ui";

/** Value of the logo field. `logoImage: undefined` = keep the current uploaded image unchanged. */
export interface LogoValue {
  logoKey: string | null;
  logoImage: string | null | undefined;
}

const MAX_SIDE = 256;

/** Renders a gallery logo tile (static, trusted SVG strings from ai-logos.ts). */
export function AiLogoTile({ logoKey, size = 40, className = "" }: { logoKey: string; size?: number; className?: string }) {
  const logo = findAiLogo(logoKey);
  if (!logo) return null;
  return (
    <span
      role="img"
      aria-label={logo.label}
      className={`inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: aiLogoSvg(logo, size) }}
    />
  );
}

/** Product logo from the API (`logoUrl`) or a placeholder. */
export function ProductLogo({ url, name, size = 40 }: { url: string | null | undefined; name: string; size?: number }) {
  if (!url) {
    return (
      <span
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center rounded-xl bg-card-2 font-semibold text-muted"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={`Logo ${name}`} width={size} height={size} className="shrink-0 rounded-xl object-cover" style={{ width: size, height: size }} />;
}

/** Resizes an uploaded file to at most 256x256 PNG (keeps the database light and strips metadata). */
async function fileToLogoDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use uma imagem PNG, JPEG ou WebP.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Imagem muito grande (máx. 10 MB).");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let data = canvas.toDataURL("image/png");
  if (data.length > 340_000) data = canvas.toDataURL("image/webp", 0.9);
  if (data.length > 340_000) throw new Error("Imagem muito complexa; tente uma versão mais simples.");
  return data;
}

export function LogoPicker({
  value,
  onChange,
  currentUrl,
  disabled,
}: {
  value: LogoValue;
  onChange: (v: LogoValue) => void;
  /** URL of the logo already saved (used to preview an uploaded image that is kept). */
  currentUrl?: string | null;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const keepsUpload = value.logoImage === undefined && !value.logoKey && Boolean(currentUrl);
  const previewUpload = value.logoImage ?? (keepsUpload ? currentUrl : null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      onChange({ logoKey: null, logoImage: await fileToLogoDataUrl(file) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line">
          {value.logoKey ? (
            <AiLogoTile logoKey={value.logoKey} size={56} />
          ) : previewUpload ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUpload} alt="Logo enviada" className="h-14 w-14 rounded-xl object-cover" />
          ) : (
            <span className="text-xs text-muted">Sem logo</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={disabled} onClick={() => fileRef.current?.click()}>
            Enviar imagem
          </Button>
          {(value.logoKey || previewUpload) && (
            <Button type="button" variant="ghost" disabled={disabled} onClick={() => onChange({ logoKey: null, logoImage: null })}>
              Remover logo
            </Button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} />
        </div>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div>
        <p className="mb-2 text-xs text-muted">Ou escolha uma logo de IA:</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2">
          {AI_LOGOS.map((l) => {
            const selected = value.logoKey === l.key;
            return (
              <button
                key={l.key}
                type="button"
                disabled={disabled}
                title={l.label}
                aria-pressed={selected}
                onClick={() => onChange({ logoKey: l.key, logoImage: null })}
                className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-[11px] leading-tight transition ${
                  selected ? "border-accent ring-2 ring-accent" : "border-line hover:border-accent"
                }`}
              >
                <AiLogoTile logoKey={l.key} size={36} />
                <span className="line-clamp-2 text-center text-muted">{l.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
