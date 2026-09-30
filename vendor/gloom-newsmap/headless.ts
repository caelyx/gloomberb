import type {
  HeadlessPaneDefinition,
  HeadlessPaneLoadArgs,
  HeadlessRowsResult,
} from "gloomberb/types/plugin";
import { loadFeed, type LoadedFeed } from "./cache";
import { configuredEditionId } from "./config";
import { dedupeHeadlines, formatAge, storyWeight } from "./model";
import {
  DEFAULT_SECTIONS, EDITIONS, editionById, isSectionId, sectionLabel, type Headline,
} from "./types";

/**
 * The text and JSON form of the map, for `gloomberb fn NMAP`.
 *
 * A treemap does not survive `--json`, so this is the data behind it: the same
 * stories, ranked by the same weight, as a table. Without it the host falls
 * back to screenshotting the pane and scraping the text back out, which is
 * clipped, fragile, and formatted for tiles rather than for reading.
 *
 * Nothing here may touch React or the DOM — a headless loader runs under the
 * CLI with no renderer. That is free: the modules it builds on were already
 * kept host-free so they could be unit-tested.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

export function projectNewsmapRows(
  headlines: readonly Headline[],
  now: number,
  limit: number,
): HeadlessRowsResult {
  const ranked = dedupeHeadlines(headlines)
    .sort((a, b) => storyWeight(b) - storyWeight(a))
    .slice(0, limit);

  return {
    columns: [
      { key: "rank", header: "#", align: "right", width: 3 },
      { key: "title", header: "Headline" },
      { key: "source", header: "Source" },
      { key: "section", header: "Section" },
      { key: "age", header: "Age", align: "right" },
      { key: "weight", header: "Weight", align: "right", format: (value) => (value as number).toFixed(2) },
    ],
    rows: ranked.map((headline, index) => ({
      rank: index + 1,
      title: headline.title,
      source: headline.source,
      section: sectionLabel(headline.section),
      sectionId: headline.section,
      age: formatAge(now - headline.publishedAt),
      // The machine-readable companions to the display columns: a script wants
      // the URL and a real timestamp, not "3h".
      url: headline.url,
      publishedAt: new Date(headline.publishedAt).toISOString(),
      weight: Number(storyWeight(headline).toFixed(4)),
      outlets: headline.relatedCount + 1,
    })),
  };
}

/** Explicit argument beats an option, which beats the pane's own setting, which
 * beats the plugin default — the same order a reader would guess. */
function resolveEdition(args: HeadlessPaneLoadArgs, settings: Record<string, unknown> | undefined): string {
  const fromArgument = typeof args.argument === "string" ? args.argument.trim() : "";
  const fromOption = typeof args.options.edition === "string" ? args.options.edition : "";
  const fromSetting = typeof settings?.edition === "string" ? settings.edition : "";
  const candidate = fromArgument || fromOption || fromSetting;
  return candidate ? editionById(candidate).id : configuredEditionId();
}

function resolveSections(args: HeadlessPaneLoadArgs, settings: Record<string, unknown> | undefined): string[] {
  const raw = typeof args.options.sections === "string" && args.options.sections
    ? args.options.sections.split(",")
    : Array.isArray(settings?.sections) ? settings.sections as string[] : [];
  const chosen = raw.map((id) => String(id).trim().toUpperCase()).filter(isSectionId);
  return chosen.length > 0 ? [...new Set(chosen)] : [...DEFAULT_SECTIONS];
}

function resolveLimit(value: unknown): number {
  const limit = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

export interface NewsmapHeadlessDependencies {
  load(sections: readonly string[], edition: string, options: { force: boolean }): Promise<LoadedFeed>;
}

const defaultDependencies: NewsmapHeadlessDependencies = {
  load: (sections, edition, options) => loadFeed(sections, edition, options),
};

export function createNewsmapHeadless(
  dependencies: NewsmapHeadlessDependencies = defaultDependencies,
): HeadlessPaneDefinition<"rows"> {
  return {
    shape: "rows",
    discovery: {
      aliases: ["news", "newsmap", "heatmap", "headlines", "treemap", "world"],
      intents: [
        "What is in the news right now",
        "Top world, national, business and technology headlines",
      ],
      dataRequirements: ["Google News RSS"],
      limitations: [
        "Ranking is Google's feed order and how many outlets carry a story, not an editorial judgement.",
        "The treemap itself is only in the pane; this is the table behind it.",
      ],
    },
    argument: {
      kind: "free-text",
      optional: true,
      placeholder: "edition",
      description: "Regional edition, such as AU or US. Defaults to the configured edition.",
    },
    options: [
      {
        key: "edition",
        description: "Google News regional edition.",
        type: "enum",
        settingKey: "edition",
        values: EDITIONS.map((edition) => ({
          value: edition.id,
          aliases: [edition.label],
        })),
      },
      {
        key: "sections",
        description: "Comma-separated sections to merge, such as WORLD,BUSINESS. Defaults to World, National, Business and Tech.",
        type: "string",
      },
      {
        key: "limit",
        description: "How many stories to return.",
        type: "integer",
        defaultValue: DEFAULT_LIMIT,
        minimum: 1,
        maximum: MAX_LIMIT,
      },
    ],
    describe: (args) => {
      const edition = typeof args.argument === "string" && args.argument.trim()
        ? editionById(args.argument.trim()).label
        : typeof args.options.edition === "string"
          ? editionById(args.options.edition).label
          : editionById(configuredEditionId()).label;
      return `World news · ${edition}`;
    },
    async load(args, ctx): Promise<HeadlessRowsResult> {
      const edition = resolveEdition(args, ctx.settings);
      const sections = resolveSections(args, ctx.settings);
      // `--refresh` asks for the network; everything else is happy with the
      // cache the pane already fills.
      const feed = await dependencies.load(sections, edition, { force: ctx.refresh === true });
      const projected = projectNewsmapRows(feed.headlines, Date.now(), resolveLimit(args.options.limit));

      return {
        ...projected,
        // A partial board is still worth printing, but it must not claim to be
        // the whole map.
        complete: feed.failedSections.length === 0,
        ...(feed.failedSections.length > 0
          ? { errors: [`No response for ${feed.failedSections.map(sectionLabel).join(", ")}.`] }
          : {}),
        metadata: {
          edition,
          editionLabel: editionById(edition).label,
          sections,
          fetchedAt: feed.fetchedAt,
          stale: feed.stale,
        },
      };
    },
  };
}
