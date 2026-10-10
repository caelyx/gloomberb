import type { HeadlessPaneDefinition } from "gloomberb/types/plugin";
import { refreshNotice } from "../shared/cache-status";
import { sydneyToday } from "../shared/time";
import { loadContracts } from "./client";
import type { ContractWindow } from "./model";
import { formatAud } from "./pane";

/** `gloomberb fn AUTN [--window 1D|3D|7D] [--asx]`: the largest recent AusTender contracts. */
export const contractsHeadless = {
  shape: "rows",
  argument: { kind: "none" },
  options: [
    { key: "window", description: "Contracts published over the last 1, 3 or 7 days.", type: "enum", values: [{ value: "1D" }, { value: "3D" }, { value: "7D" }], defaultValue: "3D" },
    { key: "asx", description: "Only contracts with ASX-listed suppliers.", type: "boolean", defaultValue: false },
    { key: "top", description: "How many contracts, largest first.", type: "integer", defaultValue: 50, minimum: 1, maximum: 1000 },
  ],
  columns: [
    { key: "published", header: "Published" },
    { key: "agency", header: "Agency" },
    { key: "supplier", header: "Supplier" },
    { key: "asx", header: "ASX" },
    { key: "value", header: "Value", align: "right", format: (value) => formatAud(typeof value === "number" ? value : null) },
    { key: "description", header: "Description" },
  ],
  describe: (args) => `AusTender contracts | ${String(args.options.window ?? "3D")}`,
  // Contracts as agencies publish them.
  freshness: { source: "AusTender", status: "not-a-feed", basis: "published contracts" },
  async load(args, ctx) {
    const list = await loadContracts((args.options.window as ContractWindow | undefined) ?? "3D", { force: ctx.refresh, signal: ctx.signal });
    const rows = list.contracts
      .filter((contract) => !args.options.asx || contract.asxCode)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .slice(0, Number(args.options.top ?? 50))
      .map((contract) => ({
        published: sydneyToday(contract.publishedAt),
        agency: contract.agency,
        supplier: contract.supplier,
        asx: contract.asxCode,
        value: contract.value,
        description: contract.description,
        id: contract.id,
      }));
    return {
      rows,
      ...(list.complete ? {} : { complete: false, errors: ["Window cut short: more contracts were published than were loaded."] }),
      ...(list.meta.refreshError ? { notes: refreshNotice(list.meta) } : {}),
    };
  },
} satisfies HeadlessPaneDefinition<"rows">;
