const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2560;

/** An image picked in the dashboard, ready to be posted as base64. */
export interface Attachment {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  previewUrl: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Keeps small JPEG/PNG/WebP files as they are; anything else (or too big) is re-encoded as JPEG. */
export async function prepareImage(file: File): Promise<Attachment> {
  if (!file.type.startsWith("image/")) throw new Error("O arquivo precisa ser uma imagem.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Não foi possível ler a imagem.");
  });
  const keep = ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= MAX_IMAGE_BYTES && Math.max(bitmap.width, bitmap.height) <= MAX_IMAGE_SIDE;
  let blob: Blob = file;
  if (!keep) {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao converter a imagem."))), "image/jpeg", 0.85));
    if (blob.size > MAX_IMAGE_BYTES) throw new Error("Imagem muito grande (máx. 3 MB).");
  }
  bitmap.close();
  return { contentType: keep ? (file.type as Attachment["contentType"]) : "image/jpeg", base64: await blobToBase64(blob), previewUrl: URL.createObjectURL(blob) };
}
