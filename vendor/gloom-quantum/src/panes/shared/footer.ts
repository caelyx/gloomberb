// Footer for any pane that shows results: the dataset version (brief §8 rule
// 6), `o` to open the current source and `O` to step to the next one.
import { useEffect, useMemo, useState } from "react";
import { usePaneStatusLinkFooter, type PaneFooterSegment, type PaneHint } from "gloomberb/components";
import type { Source } from "../../schema";
import { sourceUrl } from "../../sources";

const NO_HINTS: PaneHint[] = [];

export function useSourceFooter({
  registrationId,
  focused,
  datasetVersion,
  sources,
  hints = NO_HINTS,
  info,
}: {
  registrationId: string;
  focused: boolean;
  datasetVersion: string;
  /** The sources of the result in view; the footer opens the current one. */
  sources: readonly Source[] | null;
  hints?: PaneHint[];
  info?: PaneFooterSegment[];
}): { sourceIndex: number } {
  const [sourceIndex, setSourceIndex] = useState(0);
  const key = sources?.map((s) => s.id).join("|") ?? "";
  useEffect(() => setSourceIndex(0), [key]);
  const count = sources?.length ?? 0;
  const index = count ? sourceIndex % count : 0;
  const url = count ? sourceUrl(sources![index]!) : null;

  const allHints = useMemo<PaneHint[]>(() => [
    ...hints,
    ...(count > 1
      ? [{ id: "next-source", key: "O", label: `next source (${index + 1}/${count})`, onPress: () => setSourceIndex((i) => i + 1) }]
      : []),
  ], [count, hints, index]);
  const allInfo = useMemo<PaneFooterSegment[]>(() => [
    ...(info ?? []),
    { id: "dataset", parts: [{ text: `dataset ${datasetVersion}`, tone: "muted" }] },
  ], [datasetVersion, info]);

  usePaneStatusLinkFooter({
    registrationId,
    focused,
    url,
    label: "source",
    info: allInfo,
    hints: allHints,
    showOpenHint: !!url,
  });
  return { sourceIndex: index };
}
