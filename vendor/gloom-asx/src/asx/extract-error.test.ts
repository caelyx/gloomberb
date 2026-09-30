import { describe, expect, test } from "bun:test";
import { AsxHttpError } from "./client";
import { ExtractUnavailableError, classifyExtractFailure, toExtractUnavailable } from "./extract-error";
import { PdfUnreadableError } from "./pdf-text";

function named(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("classifyExtractFailure", () => {
  test("HTTP statuses from the PDF host", () => {
    const url = "https://cdn-api.markitdigital.com/x";
    expect(classifyExtractFailure(new AsxHttpError(413, url))).toBe("too-large");
    expect(classifyExtractFailure(new AsxHttpError(404, url))).toBe("not-found");
    expect(classifyExtractFailure(new AsxHttpError(403, url))).toBe("refused");
    expect(classifyExtractFailure(new AsxHttpError(401, url))).toBe("refused");
    expect(classifyExtractFailure(new AsxHttpError(500, url))).toBe("server");
    expect(classifyExtractFailure(new AsxHttpError(504, url))).toBe("timeout");
  });

  test("Gloomberb's web proxy refusals, which arrive as thrown errors and are not blamed on ASX", () => {
    const refused = (status: number, detail: string) => new Error(`Plugin request was refused (${status}). {"error":"${detail}"}`);
    expect(classifyExtractFailure(refused(502, "The upstream response is too large."))).toBe("too-large");
    expect(classifyExtractFailure(refused(504, "The upstream request timed out."))).toBe("timeout");
    expect(classifyExtractFailure(refused(504, "The upstream request failed."))).toBe("network");
    expect(classifyExtractFailure(refused(403, "The target host is not on the plugin allowlist."))).toBe("network");
    expect(classifyExtractFailure(refused(401, "Sign in to use plugin requests."))).toBe("network");
  });

  test("timeouts and failed connections, in the words of each runtime", () => {
    expect(classifyExtractFailure(named("TimeoutError", "The operation timed out."))).toBe("timeout");
    // The desktop transport rejects with its own AbortError when the throttled fetch's timeout fires.
    expect(classifyExtractFailure(named("AbortError", "The operation was aborted."))).toBe("timeout");
    for (const message of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
      expect(classifyExtractFailure(new TypeError(message))).toBe("network");
    }
    expect(classifyExtractFailure(new Error("getaddrinfo ENOTFOUND cdn-api.markitdigital.com"))).toBe("network");
    expect(classifyExtractFailure(new Error("Unable to connect. Is the computer able to access the url?"))).toBe("network");
  });

  test("pdf.js and content errors", () => {
    expect(classifyExtractFailure(named("PasswordException", "No password given"))).toBe("encrypted");
    expect(classifyExtractFailure(new PdfUnreadableError())).toBe("unreadable");
    expect(classifyExtractFailure(named("InvalidPDFException", "Invalid PDF structure."))).toBe("unreadable");
    expect(classifyExtractFailure(named("FormatError", "Bad FCHECK in flate stream"))).toBe("unreadable");
    // Numbers and words in pdf.js messages are not read as HTTP statuses or encryption.
    expect(classifyExtractFailure(named("FormatError", "Bad reference 413 0 R in encrypt dictionary"))).toBe("unreadable");
    expect(classifyExtractFailure("weird")).toBe("unreadable");
  });
});

describe("ExtractUnavailableError", () => {
  test("messages point at the original PDF and carry no implementation detail", () => {
    for (const reason of ["too-large", "not-found", "refused", "server", "timeout", "network", "encrypted", "unreadable"] as const) {
      const { message } = new ExtractUnavailableError(reason);
      expect(message).toStartWith("Inline extract unavailable");
      expect(message).toMatch(/original PDF/);
      expect(message).not.toMatch(/https?:|Exception|\(\d{3}\)|proxy/);
    }
    expect(new ExtractUnavailableError("too-large").message).toContain("too large to download");
    expect(new ExtractUnavailableError("unreadable").message).toBe("Inline extract unavailable for this document. Open the original PDF to view it.");
  });

  test("only server errors, timeouts and failed downloads are worth retrying without being asked", () => {
    expect(new ExtractUnavailableError("timeout").transient).toBe(true);
    expect(new ExtractUnavailableError("server").transient).toBe(true);
    expect(new ExtractUnavailableError("network").transient).toBe(true);
    expect(new ExtractUnavailableError("refused").transient).toBe(false);
    expect(new ExtractUnavailableError("too-large").transient).toBe(false);
    expect(new ExtractUnavailableError("unreadable").transient).toBe(false);
  });

  test("toExtractUnavailable keeps the original error as the cause", () => {
    const cause = new AsxHttpError(404, "https://cdn-api.markitdigital.com/x");
    const wrapped = toExtractUnavailable(cause);
    expect(wrapped.reason).toBe("not-found");
    expect(wrapped.cause).toBe(cause);
    expect(toExtractUnavailable(wrapped)).toBe(wrapped);
  });
});
