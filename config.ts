import type { GloomPluginContext } from "gloomberb/types/plugin";
import {
  DEFAULT_EDITION_ID, DEFAULT_PROVIDER_SCOPE, editionById, providerScopeSections, type SectionId,
} from "./types";

/**
 * Plugin-scoped settings, as opposed to the per-pane ones.
 *
 * The edition needs both: a pane is a view and may reasonably sit on a
 * different edition from its neighbour, but the `news` capability answers
 * queries from the whole app with no pane attached, so it needs an edition of
 * its own. This is that one — the plugin's default, which new panes adopt and
 * the capability always uses.
 */
export const EDITION_CONFIG_KEY = "edition";
export const PROVIDER_SCOPE_CONFIG_KEY = "providerScope";

let pluginContext: GloomPluginContext | null = null;

export function setConfigContext(ctx: GloomPluginContext | null): void {
  pluginContext = ctx;
}

export function configuredEditionId(): string {
  const stored = pluginContext?.configState.get<string>(EDITION_CONFIG_KEY);
  // Validated rather than trusted: the value is user-editable and a stale id
  // would otherwise build a URL for an edition that no longer exists.
  return stored ? editionById(stored).id : DEFAULT_EDITION_ID;
}

/**
 * Which sections the `news` capability answers host queries with, when the
 * query does not name its own. Defaults to markets, so the provider does not
 * drop beach closures into a feed of earnings calls.
 */
export function configuredProviderSections(): readonly SectionId[] {
  const stored = pluginContext?.configState.get<string>(PROVIDER_SCOPE_CONFIG_KEY);
  return providerScopeSections(stored ?? DEFAULT_PROVIDER_SCOPE);
}
