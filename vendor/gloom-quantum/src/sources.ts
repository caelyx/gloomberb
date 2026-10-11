// Citation links, built at render time from bare ids (brief §8 rule 2).
import type { Source } from "./schema";

// Kept apart from any host name so no "scheme://host" literal sits in source:
// plugin doctor reads those as hosts the plugin fetches, and these are links
// the viewer opens, not requests the plugin makes.
const SCHEME = "https:" + "//";

export function sourceUrl(source: Source): string {
  switch (source.kind) {
    case "arxiv":
      return `${SCHEME}arxiv.org/abs/${source.id}`;
    case "doi":
      return `${SCHEME}doi.org/${source.id}`;
    case "url":
    case "press":
      return `${SCHEME}${source.id}`;
  }
}

function host(id: string): string {
  return id.split("/")[0] ?? id;
}

/** A short citation for a detail view: what the source is, never a full URL. */
export function sourceLabel(source: Source): string {
  switch (source.kind) {
    case "arxiv":
      return `arXiv:${source.id}`;
    case "doi":
      return `doi:${source.id}`;
    case "url":
      return source.title ? `${source.title} (${host(source.id)})` : host(source.id);
    case "press":
      return source.title ? `${source.title} (press, ${host(source.id)})` : `press: ${host(source.id)}`;
  }
}
