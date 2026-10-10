import type { GloomPluginContext } from "gloomberb/types/plugin";
import { openElectricityKey, setOpenElectricityKey } from "./client";
import { OPEN_ELECTRICITY_KEY_SETTING } from "./openelectricity";

export const CLEAR_OPEN_ELECTRICITY_KEY_COMMAND = "au-markets:clear-openelectricity-key";

type SettingsContext = Pick<GloomPluginContext, "configState" | "on" | "registerCommand" | "notify">;

/**
 * The OpenElectricity key outside React: kept in step with the settings for
 * the chart series (a key added or removed without the NEM pane open), and a
 * command to remove it, since the setup form leaves a cleared optional field
 * as it was. Call once from `setup()`; returns the disposer.
 */
export function setupOpenElectricity(ctx: SettingsContext): () => void {
  const sync = () => setOpenElectricityKey(ctx.configState.get<string>(OPEN_ELECTRICITY_KEY_SETTING));
  sync();
  const dispose = ctx.on("config:changed", sync);
  ctx.registerCommand({
    id: CLEAR_OPEN_ELECTRICITY_KEY_COMMAND,
    label: "Clear OpenElectricity API key",
    description: "Remove the key from the Australian Markets settings; the NEM pane goes back to AEMO's figures alone",
    keywords: ["openelectricity", "api key", "remove", "clear", "nem", "rooftop solar", "battery"],
    category: "config",
    hidden: () => !openElectricityKey(),
    confirm: {
      title: "Clear the OpenElectricity API key?",
      body: ["The NEM pane, its chart series and `gloomberb fn NEM` stop asking OpenElectricity, and show AEMO's figures alone."],
      confirmLabel: "Clear key",
      tone: "danger",
    },
    async execute() {
      try {
        await ctx.configState.delete(OPEN_ELECTRICITY_KEY_SETTING);
        setOpenElectricityKey(null);
        ctx.notify({ body: "OpenElectricity API key removed.", type: "success" });
      } catch (error) {
        ctx.notify({ body: `Could not remove the OpenElectricity API key: ${error instanceof Error ? error.message : String(error)}`, type: "error" });
      }
    },
  });
  return dispose;
}
