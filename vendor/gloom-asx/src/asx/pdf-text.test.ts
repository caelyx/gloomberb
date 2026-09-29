import { describe, expect, test } from "bun:test";
import { PdfUnreadableError, extractPdfText } from "./pdf-text";

async function fixture(name: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await Bun.file(new URL(`../../test/fixtures/${name}`, import.meta.url)).arrayBuffer());
}

/** What a proxy that carries the body as a string hands back. */
async function throughTextEnvelope(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(await new Response(bytes).text()).arrayBuffer());
}

describe("extractPdfText", () => {
  test("reads the text of a small PDF", async () => {
    const { text, totalPages } = await extractPdfText(await fixture("sample-announcement.pdf"), { maxPages: 2 });
    expect(totalPages).toBe(1);
    expect(text).toContain("Commonwealth Bank completes buy-back");
  });

  test("reads a PDF whose content stream is compressed, as real ASX PDFs are", async () => {
    const { text } = await extractPdfText(await fixture("compressed-announcement.pdf"));
    expect(text).toContain("Compressed stream sample");
  });

  test("a binary PDF decoded as text on the way is refused rather than read as empty", async () => {
    const mangled = await throughTextEnvelope(await fixture("compressed-announcement.pdf"));
    await expect(extractPdfText(mangled)).rejects.toBeInstanceOf(PdfUnreadableError);
  });

  test("empty bytes and non-PDF bodies are refused before pdf.js sees them", async () => {
    for (const body of ["", "<html><body>Access denied</body></html>"]) {
      await expect(extractPdfText(new TextEncoder().encode(body))).rejects.toBeInstanceOf(PdfUnreadableError);
    }
  });

  test("a malformed PDF rejects instead of hanging", async () => {
    const truncated = (await fixture("compressed-announcement.pdf")).slice(0, 200);
    await expect(extractPdfText(truncated)).rejects.toThrow();
  });
});
