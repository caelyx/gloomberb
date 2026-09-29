export const NEWSMAP_PLUGIN_ID = "newsmap";
export const NEWSMAP_PANE_ID = "newsmap";
export const GOOGLE_NEWS_SOURCE_ID = "google-news";

/**
 * Newsmap's six sections, plus Top Stories. The id is the Google News topic
 * path segment; "TOP" is the edition front page, which has no topic segment.
 */
/**
 * Every hue here is dark enough that white text clears 4.5:1 on it, and tiles
 * only ever fade darker, so one text colour serves the whole map. Picking the
 * text colour per tile instead made it flip from white to black partway down
 * the age ramp, which reads as a second encoding that is not there.
 */
export const SECTIONS = [
  { id: "TOP", label: "Top", hue: "#5f7488" },
  { id: "WORLD", label: "World", hue: "#7b5ea7" },
  { id: "NATION", label: "National", hue: "#377e50" },
  { id: "BUSINESS", label: "Business", hue: "#a06122" },
  { id: "TECHNOLOGY", label: "Tech", hue: "#2f6fb0" },
  { id: "ENTERTAINMENT", label: "Showbiz", hue: "#a34272" },
  { id: "SPORTS", label: "Sport", hue: "#b04a3a" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export const SECTION_IDS: readonly SectionId[] = SECTIONS.map((section) => section.id);

const SECTION_BY_ID = new Map<string, (typeof SECTIONS)[number]>(
  SECTIONS.map((section) => [section.id, section]),
);

export function sectionHue(id: string): string {
  return SECTION_BY_ID.get(id)?.hue ?? "#5f7488";
}

export function sectionLabel(id: string): string {
  return SECTION_BY_ID.get(id)?.label ?? id;
}

export function isSectionId(value: string): value is SectionId {
  return SECTION_BY_ID.has(value);
}

/**
 * The regional editions Newsola offers. `hl` is the interface language, `gl`
 * the country, and `ceid` the pair Google News actually keys the edition on.
 */
export interface Edition {
  id: string;
  label: string;
  hl: string;
  gl: string;
  ceid: string;
}

export const EDITIONS: readonly Edition[] = [
  { id: "US", label: "United States", hl: "en-US", gl: "US", ceid: "US:en" },
  { id: "GB", label: "United Kingdom", hl: "en-GB", gl: "GB", ceid: "GB:en" },
  { id: "AU", label: "Australia", hl: "en-AU", gl: "AU", ceid: "AU:en" },
  { id: "CA", label: "Canada", hl: "en-CA", gl: "CA", ceid: "CA:en" },
  { id: "IN", label: "India", hl: "en-IN", gl: "IN", ceid: "IN:en" },
  { id: "AR", label: "Argentina", hl: "es-419", gl: "AR", ceid: "AR:es-419" },
  { id: "BR", label: "Brazil", hl: "pt-BR", gl: "BR", ceid: "BR:pt-419" },
  { id: "CN", label: "China", hl: "zh-CN", gl: "CN", ceid: "CN:zh-Hans" },
  { id: "CO", label: "Colombia", hl: "es-419", gl: "CO", ceid: "CO:es-419" },
  { id: "FR", label: "France", hl: "fr", gl: "FR", ceid: "FR:fr" },
  { id: "DE", label: "Germany", hl: "de", gl: "DE", ceid: "DE:de" },
  { id: "IT", label: "Italy", hl: "it", gl: "IT", ceid: "IT:it" },
  { id: "JP", label: "Japan", hl: "ja", gl: "JP", ceid: "JP:ja" },
  { id: "KR", label: "South Korea", hl: "ko", gl: "KR", ceid: "KR:ko" },
  { id: "RU", label: "Russia", hl: "ru", gl: "RU", ceid: "RU:ru" },
  { id: "ES", label: "Spain", hl: "es", gl: "ES", ceid: "ES:es" },
];

const EDITION_BY_ID = new Map(EDITIONS.map((edition) => [edition.id, edition]));

export const DEFAULT_EDITION_ID = "AU";

export function editionById(id: string | null | undefined): Edition {
  return EDITION_BY_ID.get(id ?? "") ?? EDITION_BY_ID.get(DEFAULT_EDITION_ID)!;
}

/** One story, normalised across both sources so the treemap sees one shape. */
export interface Headline {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  section: string;
  /** Position in its own section's feed, 0-based. Newsmap's importance signal. */
  rank: number;
  /** Other outlets carrying the same story. Google News caps this at five. */
  relatedCount: number;
}

export type SourceId = "google" | "gloom";

/**
 * How much of the pane one story gets. The pane's size already decides this in
 * the main, but the right answer depends on what the reader wants from the
 * map: a wall display wants a handful of big tiles, a docked column wants as
 * many headlines as it can still spell out.
 */
export type Density = "sparse" | "normal" | "dense";

export const DENSITIES: ReadonlyArray<{ id: Density; label: string; description: string }> = [
  { id: "sparse", label: "Sparse", description: "Fewer, bigger tiles." },
  { id: "normal", label: "Normal", description: "The default balance." },
  { id: "dense", label: "Dense", description: "As many headlines as stay readable." },
];

export const DEFAULT_DENSITY: Density = "normal";

export function isDensity(value: unknown): value is Density {
  return DENSITIES.some((density) => density.id === value);
}

/**
 * Hues for groups that are not one of Newsmap's sections — the topics
 * Gloomberb's own news feed reports, which vary by day and have no fixed
 * taxonomy to colour against.
 */
const EXTRA_HUES = [
  "#2f6fb0", "#a06122", "#377e50", "#7b5ea7", "#b04a3a",
  "#a34272", "#2b7c78", "#6b7f2a", "#5f7488", "#8a5a3c",
];

/**
 * A stable hue per group: Newsmap's own sections keep the colours the map is
 * known for, and anything else takes the next unused hue in order of first
 * appearance, so the legend and the tiles always agree.
 */
export function assignHues(keys: readonly string[]): Map<string, string> {
  const hues = new Map<string, string>();
  const sections = keys.filter(isSectionId);
  // Hues a section on this board already owns are off the table, or a free-form
  // topic from the host feed lands on the same colour as a section beside it.
  const taken = new Set(sections.map(sectionHue));
  const spare = EXTRA_HUES.filter((hue) => !taken.has(hue));

  let next = 0;
  for (const key of keys) {
    if (hues.has(key)) continue;
    if (isSectionId(key)) {
      hues.set(key, sectionHue(key));
      continue;
    }
    // Past the spare hues the map repeats rather than inventing colours; more
    // than ten live topics is not a board anyone is reading anyway.
    hues.set(key, spare.length > 0 ? spare[next % spare.length]! : sectionHue(key));
    next += 1;
  }
  return hues;
}

/**
 * What the `news` capability serves the rest of the app, as opposed to what
 * the pane draws.
 *
 * The two are deliberately different. In the heatmap, a story about a beach
 * closure is a legitimate tile — it is what is happening today. In Gloomberb's
 * own news feed, sitting between a Fed story and an earnings call, it is
 * noise. Markets-only makes the provider additive rather than something a
 * reader would want to switch off.
 */
export const CAPABILITY_SECTIONS: readonly SectionId[] = ["BUSINESS", "TECHNOLOGY"];

export type ProviderScope = "markets" | "general";

export const PROVIDER_SCOPES: ReadonlyArray<{ id: ProviderScope; label: string; description: string }> = [
  { id: "markets", label: "Markets only", description: "Business and Tech. Keeps general news out of Gloomberb's news feed." },
  { id: "general", label: "Everything the pane shows", description: "World, National, Business and Tech." },
];

export const DEFAULT_PROVIDER_SCOPE: ProviderScope = "markets";

export function providerScopeSections(scope: string | null | undefined): readonly SectionId[] {
  return scope === "general" ? DEFAULT_SECTIONS : CAPABILITY_SECTIONS;
}

/**
 * The sections that open by default. Sport and Showbiz are off — they are the
 * two that most reliably crowd out the news someone opened a terminal for, and
 * both are one keypress away. Top Stories overlaps all of them and is opt-in.
 */
export const DEFAULT_SECTIONS: readonly SectionId[] = [
  "WORLD", "NATION", "BUSINESS", "TECHNOLOGY",
];
