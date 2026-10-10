import type { CliCommandContext, CliCommandDef } from "gloomberb/types/plugin";
import { loadFranking } from "./franking/client";
import { frankingCredit, grossedUpYield, grossUpFactor } from "./franking/model";
import { asxCodeFromSymbol } from "./shared/asx";

type Subcommand = (args: string[], ctx: CliCommandContext) => Promise<void>;

function requireCode(value: string | undefined, usage: string, ctx: CliCommandContext): string {
  const code = value ? asxCodeFromSymbol(value) ?? asxCodeFromSymbol(value, "ASX") : null;
  if (!code) ctx.fail(usage);
  return code;
}

const subcommands: Record<string, { usage: string; run: Subcommand }> = {
  franking: {
    usage: "gloomberb au franking <ASX ticker>",
    async run(args, ctx) {
      const code = requireCode(args[0], "Usage: gloomberb au franking <ASX ticker>", ctx);
      const snapshot = await loadFranking(code, { force: ctx.cliOptions.refresh });
      const franking = snapshot.frankingPercent;
      const amount = snapshot.amount;
      ctx.printResult({
        data: {
          code,
          kind: snapshot.kind,
          cashAud: amount,
          declared: snapshot.declaredAmount != null ? `${snapshot.declaredCurrency} ${snapshot.declaredAmount}` : null,
          frankingPercent: franking,
          creditAud: amount != null && franking != null ? Number(frankingCredit(amount, franking).toFixed(6)) : null,
          grossedUpAud: amount != null && franking != null ? Number((amount * grossUpFactor(franking)).toFixed(6)) : null,
          exDate: snapshot.exDate,
          recordDate: snapshot.recordDate,
          payDate: snapshot.payDate,
          cashYield: snapshot.annualYield,
          grossYield: grossedUpYield(snapshot.annualYield, franking),
        },
        metadata: { taxRate: 0.3 },
      }, { layout: "record" });
    },
  },
};

export const auCliCommand: CliCommandDef = {
  name: "au",
  description: "Australian market data: franking and more",
  help: {
    group: "Australian Markets",
    usage: Object.values(subcommands).map((entry) => entry.usage.replace(/^gloomberb /, "")),
    examples: ["au franking CBA", "au franking BHP.AX --json"],
  },
  async execute(args, ctx) {
    const [name, ...rest] = args;
    const subcommand = name ? subcommands[name] : undefined;
    if (!subcommand) {
      return ctx.fail(`Usage:\n  ${Object.values(subcommands).map((entry) => entry.usage).join("\n  ")}`);
    }
    await subcommand.run(rest, ctx);
  },
};
