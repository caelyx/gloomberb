import { describe, expect, test } from "bun:test";
import { buildIssuerIndex, dedupeContracts, matchIssuer, nameKey, parseOcdsPage } from "./model";

const release = (id: string, dateSigned: string, amount: string) => ({
  date: dateSigned,
  parties: [
    { name: "Data#3 Limited", roles: ["supplier"], additionalIdentifiers: [{ id: "31010545267", scheme: "AU-ABN" }] },
    { name: "Services Australia", roles: ["procuringEntity"] },
  ],
  contracts: [{ id, dateSigned, description: "Subscriptions", value: { currency: "AUD", amount } }],
  tender: { procurementMethodDetails: "Open tender" },
});

describe("parseOcdsPage", () => {
  test("reads contract, supplier, agency and value, and the next-page link", () => {
    const page = parseOcdsPage({ releases: [release("CN1", "2026-10-06T23:55:06Z", "33300.60")], links: { next: "https://api/next" } });
    expect(page.next).toBe("https://api/next");
    expect(page.contracts[0]).toMatchObject({
      id: "CN1", supplier: "Data#3 Limited", supplierAbn: "31010545267", agency: "Services Australia",
      value: 33300.6, description: "Subscriptions", procurementMethod: "Open tender",
    });
    expect(() => parseOcdsPage({})).toThrow(/not recognised/);
  });

  test("the date is the release's publication time, not a signing date", () => {
    const payload = { releases: [{ ...release("CN2", "2026-10-06T23:55:06Z", "100"), date: "2026-10-07T01:00:00Z" }] };
    expect(new Date(parseOcdsPage(payload).contracts[0]!.publishedAt).toISOString()).toBe("2026-10-07T01:00:00.000Z");
  });

  test("an amended contract keeps its latest release", () => {
    const { contracts } = parseOcdsPage({ releases: [release("CN1", "2026-10-01T00:00:00Z", "100"), release("CN1", "2026-10-05T00:00:00Z", "150")] });
    expect(dedupeContracts(contracts).map((contract) => contract.value)).toEqual([150]);
  });
});

describe("issuer matching", () => {
  test("corporate suffixes and punctuation do not matter", () => {
    expect(nameKey("DATA#3 LIMITED")).toBe(nameKey("Data # 3 Pty. Ltd."));
    expect(nameKey("TELSTRA GROUP LIMITED")).toBe(nameKey("Telstra Limited"));
  });

  test("short keys and keys two issuers share are not matched", () => {
    const index = buildIssuerIndex([
      { code: "DTL", name: "DATA#3 LIMITED" },
      { code: "AB1", name: "AB LIMITED" },
      { code: "XX1", name: "ACME HOLDINGS LIMITED" },
      { code: "XX2", name: "ACME GROUP LIMITED" },
    ]);
    expect(index.get(nameKey("Data#3 Limited"))).toBe("DTL");
    expect(index.has(nameKey("AB Pty Ltd"))).toBe(false);
    expect(index.has(nameKey("Acme Pty Ltd"))).toBe(false);
  });

  test("a subsidiary matches its parent by leading words, but a short first word alone does not", () => {
    const index = buildIssuerIndex([{ code: "RMD", name: "RESMED INC" }, { code: "NXT", name: "NEXTDC LIMITED" }, { code: "BLD", name: "BORAL LIMITED" }]);
    expect(matchIssuer(index, "RESMED ASIA PACIFIC LTD")).toBe("RMD");
    expect(matchIssuer(index, "NextDC Ltd")).toBe("NXT");
    expect(matchIssuer(index, "BORA BORA CATERING PTY LTD")).toBeNull();
    const generic = buildIssuerIndex([{ code: "EGL", name: "THE ENVIRONMENTAL GROUP LIMITED" }]);
    expect(matchIssuer(generic, "ENVIRONMENTAL DATA ACQUISITION SERVICES")).toBeNull();
    expect(matchIssuer(generic, "The Environmental Group Ltd")).toBe("EGL");
  });
});
