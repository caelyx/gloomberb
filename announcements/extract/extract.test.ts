import { describe, expect, test } from "bun:test";
import { HttpStatusError } from "../../shared/http";
import { cleanPdfText, extractSummary } from "./clean";
import { ExtractUnavailableError, classifyExtractFailure, toExtractUnavailable } from "./errors";
import { PdfUnreadableError, extractPdfText } from "./pdf-text";

async function fixture(name: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await Bun.file(new URL(`../fixtures/${name}`, import.meta.url)).arrayBuffer());
}

describe("extractPdfText", () => {
  test("reads plain and compressed PDFs", async () => {
    const plain = await extractPdfText(await fixture("sample-announcement.pdf"), { maxPages: 2 });
    expect(plain.totalPages).toBe(1);
    expect(plain.text).toContain("Commonwealth Bank completes buy-back");
    expect((await extractPdfText(await fixture("compressed-announcement.pdf"))).text).toContain("Compressed stream sample");
  });

  test("a binary PDF decoded as text on the way, or a non-PDF body, is refused rather than read as empty", async () => {
    const mangled = new Uint8Array(await new Response(await new Response(await fixture("compressed-announcement.pdf")).text()).arrayBuffer());
    await expect(extractPdfText(mangled)).rejects.toBeInstanceOf(PdfUnreadableError);
    await expect(extractPdfText(new TextEncoder().encode("<html>Access denied</html>"))).rejects.toBeInstanceOf(PdfUnreadableError);
    await expect(extractPdfText((await fixture("compressed-announcement.pdf")).slice(0, 200))).rejects.toThrow();
  });
});

describe("cleanPdfText and extractSummary", () => {
  test("strips the watermark, page numbers and running headers of form-style PDFs", () => {
    expect(cleanPdfText("For personal use only\nASX ANNOUNCEMENT   29 September 2026\n\n\n1\nCommonwealth  Bank completes\nbuy-back.\nFor  personal use only\nPage 2 of 4\n"))
      .toBe("ASX ANNOUNCEMENT 29 September 2026\nCommonwealth Bank completes buy-back.");
    const appendix3a = [
      "Appendix 3A.1 - Notification of dividend / distribution Appendix 3A.1 - Notification of dividend / distribution 1 / 7 Update Summary Entity name COMMONWEALTH BANK OF AUSTRALIA.\nSecurity on which the Distribution will be paid CBA - ORDINARY FULLY PAID",
      "Appendix 3A.1 - Notification of dividend / distribution Appendix 3A.1 - Notification of dividend / distribution 2 / 7 Announcement Details Part 1 - Entity and announcement details",
    ].join("\f");
    expect(cleanPdfText(appendix3a)).toBe([
      "Appendix 3A.1 - Notification of dividend / distribution Update Summary Entity name COMMONWEALTH BANK OF AUSTRALIA.",
      "Security on which the Distribution will be paid CBA - ORDINARY FULLY PAID Announcement Details Part 1 - Entity and announcement details",
    ].join("\n"));
    expect(cleanPdfText("Letter\nThe vote passed 50 / 50 on the day.\fDear shareholder, the result stands."))
      .toBe("Letter The vote passed 50 / 50 on the day.\nDear shareholder, the result stands.");
    expect(cleanPdfText("Forpersonaluseonly Results are strong.")).toBe("Results are strong.");
  });

  test("keeps whole sentences within the limit and marks a cut", () => {
    expect(extractSummary("First sentence here. Second sentence follows. Third sentence is long enough to be cut off entirely.", { maxChars: 50 }))
      .toBe("First sentence here. Second sentence follows. …");
    expect(extractSummary("Short.", { maxChars: 50 })).toBe("Short.");
    expect(extractSummary("x".repeat(200), { maxChars: 50 }).endsWith("…")).toBe(true);
  });
});

describe("extract failures", () => {
  const named = (name: string, message: string) => Object.assign(new Error(message), { name });

  test("are classified from HTTP statuses, Gloomberb's proxy refusals, runtime network errors and pdf.js", () => {
    const url = "https://cdn-api.markitdigital.com/x";
    expect([413, 404, 403, 500, 504].map((status) => classifyExtractFailure(new HttpStatusError(status, url))))
      .toEqual(["too-large", "not-found", "refused", "server", "timeout"]);
    expect(classifyExtractFailure(new Error('Plugin request was refused (502). {"error":"The upstream response is too large."}'))).toBe("too-large");
    expect(classifyExtractFailure(new Error('Plugin request was refused (403). {"error":"The target host is not on the plugin allowlist."}'))).toBe("network");
    expect(classifyExtractFailure(named("AbortError", "The operation was aborted."))).toBe("timeout");
    expect(classifyExtractFailure(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyExtractFailure(named("PasswordException", "No password given"))).toBe("encrypted");
    expect(classifyExtractFailure(named("FormatError", "Bad reference 413 0 R in encrypt dictionary"))).toBe("unreadable");
  });

  test("say what to do instead, and only transient ones are retried unasked", () => {
    for (const reason of ["too-large", "not-found", "refused", "server", "timeout", "network", "encrypted", "unreadable"] as const) {
      expect(new ExtractUnavailableError(reason).message).toMatch(/^Inline extract unavailable.*original PDF/);
    }
    expect(["timeout", "server", "network", "refused"].map((reason) => new ExtractUnavailableError(reason as "timeout").transient)).toEqual([true, true, true, false]);
    const cause = new HttpStatusError(404, "https://cdn-api.markitdigital.com/x");
    expect(toExtractUnavailable(cause)).toMatchObject({ reason: "not-found", cause });
  });
});
