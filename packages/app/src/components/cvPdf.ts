import { toast } from "sonner";
import type { RenderCvDoc } from "../lib/cv/rendercv";

/** Build a CV PDF on the local server (RenderCV). Returns base64. */
export async function renderCvPdf(doc: RenderCvDoc): Promise<string> {
  const r = await fetch("/__career-desk/cv/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc }),
  });
  const json = (await r.json()) as { pdfBase64?: string; error?: string };
  if (!r.ok || !json.pdfBase64) throw new Error(json.error ?? "The CV could not be built");
  return json.pdfBase64;
}

/** Ask the local server to build a PDF with RenderCV, then download it. */
export async function downloadCvPdf(doc: RenderCvDoc, name: string) {
  const id = toast.loading("Building your CV PDF…");
  try {
    const base64 = await renderCvPdf(doc);
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^\w .-]/g, "_").slice(0, 80)}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast.success("CV PDF downloaded", { id });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e), { id });
  }
}
