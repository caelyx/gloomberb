import type { GloomPluginContext } from "gloomberb/types/plugin";
import type { TickerRecord } from "gloomberb/types/ticker";
import { parsePublicTickerKey } from "gloomberb/utils";
import { asxCodeForTicker, asxCodeFromSymbol } from "../shared/asx";

export const FRANKING_TAB_ID = "au-franking";
export const FRANKING_COMMAND_ID = "au-markets:franking";

/**
 * The ASX code `FRANK` opens: the code typed after it (`FRANK CBA`, `CBA.AX`),
 * else the selected ticker when it is an ASX listing. A bare typed code is read
 * as ASX's, as `ASXA` reads it.
 */
export function frankingCode(typed: string | undefined, selected: string | null, selectedTicker: TickerRecord | null = null): string | null {
  const arg = typed?.trim();
  // A listing picked from search arrives as its key (`VAS:XWBO`); keep its symbol, as ASXA does.
  if (arg) return asxCodeFromSymbol(arg) ?? asxCodeFromSymbol(parsePublicTickerKey(arg.toUpperCase()).symbol, "ASX");
  return selected ? asxCodeForTicker(selectedTicker, selected) : null;
}

/**
 * `FRANK <ticker>`: Ticker Research on the Franking tab, so the tab is found
 * from the command bar (also by "franking", "dividend" or "imputation").
 */
export function registerFrankingCommand(ctx: Pick<GloomPluginContext, "registerCommand" | "pinTicker" | "on" | "getTicker">): () => void {
  let selected: string | null = null;
  const dispose = ctx.on("ticker:selected", ({ symbol }) => {
    selected = symbol;
  });
  ctx.registerCommand({
    id: FRANKING_COMMAND_ID,
    label: "ASX Franking",
    description: "Franking credits, grossed-up dividend and gross yield for an ASX company (Ticker Research → Franking)",
    keywords: ["franking", "franking credits", "franked", "imputation", "dividend", "dividends", "gross yield", "grossed up", "asx", "australia"],
    shortcut: "FRANK",
    shortcutArg: { placeholder: "ASX ticker", kind: "ticker" },
    category: "data",
    execute(values) {
      const code = frankingCode(values?.shortcut, selected, selected ? ctx.getTicker(selected) : null);
      if (!code) throw new Error("Type FRANK and an ASX ticker, for example FRANK CBA.");
      ctx.pinTicker(`${code}.AX`, { tabId: FRANKING_TAB_ID });
    },
  });
  return dispose;
}
