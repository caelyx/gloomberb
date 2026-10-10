import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import {
  DataTableStackView,
  DetailScrollBody,
  EmptyState,
  Notice,
  PaneStatusBody,
  Prose,
  READING_WIDTH,
  Spinner,
  StatGrid,
  Tabs,
  useExternalLinkFooter,
  usePaneHeaderTabs,
  type DataTableCell,
  type DataTableColumn,
  type PaneFooterSegment,
  type PaneHint,
  type StatItem,
} from "gloomberb/components";
import { usePluginConfigState, usePluginPaneState } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import type { PaneProps } from "gloomberb/types/plugin";
import { Box, Text, type ScrollBoxRenderable } from "gloomberb/ui";
import { formatCompact, formatRelativeAge } from "gloomberb/utils";

import { loadArticle, type Article } from "./article";
import { discussionUrl, loadFeed, storyUrl } from "./client";
import { DEFAULT_GEMINI_MODEL, summarizeArticle } from "./summary";
import { HACKERNEWS_PANE_ID, HN_FEEDS, type HnFeedId, type HnStory } from "./types";

const PAGE_SIZE = 50;
const REFRESH_MS = 5 * 60_000;
const FEED_TABS = HN_FEEDS.map((entry) => ({ label: entry.label, value: entry.id as string }));

type Load<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; message: string };

type Column = DataTableColumn & { id: "score" | "title" | "site" | "comments" | "age" };

function buildColumns(width: number): Column[] {
  // The title takes whatever the fixed columns leave, so the table reads well
  // from a narrow split up to a full-width window. Site is the first to go.
  const columns: Column[] = [
    { id: "score", label: "PTS", width: 5, align: "right" },
    { id: "title", label: "TITLE", width: 20, align: "left", flexGrow: 1 },
  ];
  if (width > 90) columns.push({ id: "site", label: "SITE", width: 22, align: "left" });
  columns.push(
    { id: "comments", label: "CMT", width: 5, align: "right" },
    { id: "age", label: "AGE", width: 5, align: "right" },
  );
  return columns;
}

/** "42m", "3h", "2d": the AGE header already says how old, so no "ago". */
function formatAge(unixSeconds: number): string {
  const minutes = Math.floor((Date.now() / 1000 - unixSeconds) / 60);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function renderCell(story: HnStory, column: Column, rowState: { selected: boolean }): DataTableCell {
  const selected = rowState.selected ? colors.selectedText : undefined;

  switch (column.id) {
    case "score":
      return {
        text: story.score > 0 ? formatCompact(story.score) : "—",
        // Front-page threshold; enough of a signal to scan for without a legend.
        color: selected ?? (story.score >= 100 ? colors.positive : colors.textDim),
      };
    case "title":
      return { text: story.title, color: selected ?? colors.text };
    case "site":
      return { text: story.site ?? "news.ycombinator.com", color: selected ?? colors.textDim };
    case "comments":
      return {
        text: story.comments > 0 ? formatCompact(story.comments) : "—",
        color: selected ?? colors.textDim,
      };
    case "age":
      return {
        text: story.time > 0 ? formatAge(story.time) : "—",
        color: selected ?? colors.textDim,
      };
  }
}

interface StoryDetailProps {
  story: HnStory;
  width: number;
  article: Load<Article> | undefined;
  summary: Load<string> | undefined;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
}

function StoryDetail({ story, width, article, summary, scrollRef }: StoryDetailProps) {
  // The stack bar already names the story, so the detail opens on its figures.
  const stats: StatItem[] = [
    { id: "points", label: "Points", value: String(story.score) },
    { id: "comments", label: "Comments", value: String(story.comments) },
    {
      id: "posted",
      label: "Posted",
      value: story.time > 0 ? formatRelativeAge(story.time * 1000) : "—",
      detail: `by ${story.by}`,
    },
  ];
  if (story.site) stats.push({ id: "site", label: "Site", value: story.site });
  // Long lines are hard to track back across a wide pane, so text stops at
  // the host's reading width.
  const textWidth = Math.max(1, Math.min(width - 2, READING_WIDTH));

  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} width={width}>
      <StatGrid items={stats} width={width} />
      <DetailScrollBody ref={scrollRef} resetScrollKey={story.id}>
        <Box flexDirection="column" gap={1}>
          {story.text ? <Prose text={stripHtml(story.text)} width={textWidth} /> : null}
          {summary ? <SummaryBlock summary={summary} width={textWidth} /> : null}
          {story.url ? (
            <>
              {story.text || summary?.status === "ready" ? <Text fg={colors.textDim}>ARTICLE</Text> : null}
              <ArticleBody article={article} width={textWidth} />
            </>
          ) : null}
          {!story.text && !story.url ? <EmptyState title="No text body." /> : null}
        </Box>
      </DetailScrollBody>
    </Box>
  );
}

/**
 * The linked page. A story can carry text of its own as well — Show HN notes,
 * a moderator's "Related:" link — which the detail shows above this.
 */
function ArticleBody({ article, width }: { article: Load<Article> | undefined; width: number }) {
  if (!article || article.status === "loading") return <Spinner label="Reading the article..." />;
  if (article.status === "error") {
    return <EmptyState title={article.message} hint="Back out and press o to open it in the browser." />;
  }
  return <Paragraphs paragraphs={article.value.paragraphs} width={width} />;
}

function SummaryBlock({ summary, width }: { summary: Load<string>; width: number }) {
  if (summary.status === "loading") return <Spinner label="Summarising..." />;
  if (summary.status === "error") return <Notice>{summary.message}</Notice>;
  return (
    <Box flexDirection="column" gap={1}>
      <Text fg={colors.textDim}>SUMMARY</Text>
      <Paragraphs paragraphs={summary.value.split(/\n\s*\n/)} width={width} />
    </Box>
  );
}

function Paragraphs({ paragraphs, width }: { paragraphs: string[]; width: number }) {
  return (
    <Box flexDirection="column" gap={1}>
      {paragraphs.map((paragraph, index) => <Prose key={index} text={paragraph} width={width} />)}
    </Box>
  );
}

/** Ask HN bodies are HTML fragments; the terminal renderer wants plain text. */
function stripHtml(html: string): string {
  return html
    .replace(/<p>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function HackerNewsPane({ focused, width, height }: PaneProps) {
  // `usePluginPaneState` persists per pane instance, so two Hacker News panes in
  // one layout keep independent feeds and both survive a restart.
  const [feed, setFeed] = usePluginPaneState<HnFeedId>("feed", "top");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Hacker News feeds arrive already ranked, so the default is no client sort.
  const [sortColumn, setSortColumn] = useState<"score" | "comments" | "age" | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [stories, setStories] = useState<HnStory[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    setStatus((current) => (current === "ready" ? current : "loading"));
    loadFeed(feed, PAGE_SIZE, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setStories(next);
        setStatus("ready");
        setFetchedAt(Date.now());
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setStatus("error");
      });
  }, [feed]);

  useEffect(() => {
    setStories([]);
    setStatus("loading");
    refresh();
    return () => requestRef.current?.abort();
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const rows = useMemo(() => {
    if (sortColumn === "score") return [...stories].sort((a, b) => b.score - a.score);
    if (sortColumn === "comments") return [...stories].sort((a, b) => b.comments - a.comments);
    if (sortColumn === "age") return [...stories].sort((a, b) => b.time - a.time);
    return stories;
  }, [sortColumn, stories]);

  const selected = useMemo(
    () => rows.find((story) => story.id === selectedId) ?? rows[0] ?? null,
    [rows, selectedId],
  );

  const [geminiApiKey] = usePluginConfigState<string>("geminiApiKey", "");
  const [geminiModel] = usePluginConfigState<string>("geminiModel", DEFAULT_GEMINI_MODEL);

  // Keyed by story id and kept for the life of the pane, so going back to a
  // story already read, or summarised, costs nothing.
  const [articles, setArticles] = useState<ReadonlyMap<number, Load<Article>>>(new Map());
  const [summaries, setSummaries] = useState<ReadonlyMap<number, Load<string>>>(new Map());
  const articlesRef = useRef(articles);
  articlesRef.current = articles;
  const detailScrollRef = useRef<ScrollBoxRenderable | null>(null);

  // Any story with a link is read, including those that also carry HN text.
  const readingId = detailOpen && selected?.url ? selected.id : null;
  const readingUrl = readingId !== null ? selected?.url : undefined;

  // Runs each time a story is opened. A finished article is reused; a failed
  // one is tried again. Closing the story cancels the request and drops its
  // "loading" entry at once, so a reopen never waits on a cancelled request.
  useEffect(() => {
    if (readingId === null || !readingUrl) return;
    if (articlesRef.current.get(readingId)?.status === "ready") return;

    const controller = new AbortController();
    const settle = (next: Load<Article>) => {
      if (!controller.signal.aborted) setArticles((current) => new Map(current).set(readingId, next));
    };

    settle({ status: "loading" });
    loadArticle(readingUrl, controller.signal)
      .then((value) => settle({ status: "ready", value }))
      .catch((error: unknown) => settle({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load the article.",
      }));

    return () => {
      controller.abort();
      setArticles((current) => {
        if (current.get(readingId)?.status !== "loading") return current;
        const next = new Map(current);
        next.delete(readingId);
        return next;
      });
    };
  }, [readingId, readingUrl]);

  const article = selected ? articles.get(selected.id) : undefined;
  const summary = selected ? summaries.get(selected.id) : undefined;

  const summarize = useCallback(() => {
    if (!selected || article?.status !== "ready") return;
    if (summary?.status === "loading" || summary?.status === "ready") return;
    const id = selected.id;
    const settle = (next: Load<string>) => setSummaries((current) => new Map(current).set(id, next));

    if (!geminiApiKey.trim()) {
      settle({ status: "error", message: "Add a Gemini API key with Set up Hacker News in the command bar to summarise articles." });
      return;
    }
    settle({ status: "loading" });
    summarizeArticle(geminiApiKey, geminiModel.trim() || DEFAULT_GEMINI_MODEL, selected.title, article.value.paragraphs)
      .then((value) => settle({ status: "ready", value }))
      .catch((error: unknown) => settle({
        status: "error",
        message: error instanceof Error ? error.message : "Could not summarise the article.",
      }));
  }, [article, geminiApiKey, geminiModel, selected, summary]);

  const hints = useMemo<PaneHint[]>(
    () => (detailOpen && article?.status === "ready" && summary?.status !== "ready"
      ? [{ id: "summary", key: "s", label: "ummary", onPress: summarize }]
      : []),
    [article, detailOpen, summarize, summary],
  );

  const info: PaneFooterSegment[] = [];
  if (status === "loading") info.push({ id: "loading", parts: [{ text: "loading", tone: "muted" }] });
  if (status === "error") info.push({ id: "error", parts: [{ text: "error", tone: "warning" }] });
  if (status === "ready" && fetchedAt) {
    info.push({ id: "updated", parts: [{ text: formatRelativeAge(fetchedAt), tone: "muted" }] });
  }

  // Adds the "o — open" hint and the o shortcut, and renders the link source in
  // the pane footer, the same way every other Gloomberb pane with an external
  // link does.
  useExternalLinkFooter({
    registrationId: HACKERNEWS_PANE_ID,
    focused,
    url: selected ? (detailOpen ? discussionUrl(selected) : storyUrl(selected)) : null,
    source: selected ? (detailOpen ? "news.ycombinator.com" : selected.site ?? "news.ycombinator.com") : null,
    info,
    hints,
  });

  const columns = useMemo(() => buildColumns(width), [width]);

  const selectFeed = useCallback((value: string) => {
    setFeed(value as HnFeedId);
    setDetailOpen(false);
  }, [setFeed]);

  // The pane's only partition, so the desktop draws it in the title bar and the
  // table keeps the row the strip used to take.
  const tabsInHeader = usePaneHeaderTabs({
    tabs: FEED_TABS,
    activeValue: feed,
    onSelect: selectFeed,
    focused: focused && !detailOpen,
  });

  const tabs = tabsInHeader ? null : (
    <Tabs
      tabs={FEED_TABS}
      activeValue={feed}
      onSelect={selectFeed}
      focused={focused && !detailOpen}
      variant="underline"
      dense
    />
  );

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      <PaneStatusBody
        align="center"
        loading={status === "loading" && stories.length === 0}
        error={status === "error" && stories.length === 0 ? "Retries automatically." : null}
        errorTitle="Hacker News is unreachable."
      >
      <DataTableStackView<HnStory, Column>
        focused={focused}
        detailOpen={detailOpen && !!selected}
        onBack={() => setDetailOpen(false)}
        detailScrollRef={detailScrollRef}
        detailContent={selected
          ? <StoryDetail story={selected} width={width} article={article} summary={summary} scrollRef={detailScrollRef} />
          : null}
        detailTitle={selected?.title}
        selection={{
          kind: "id",
          selectedId: selected ? String(selected.id) : null,
          getId: (story) => String(story.id),
          onChange: (id) => setSelectedId(id === null ? null : Number(id)),
        }}
        onActivate={() => setDetailOpen(true)}
        rootWidth={width}
        rootHeight={Math.max(1, height - (tabsInHeader ? 0 : 1))}
        columns={columns}
        items={rows}
        getItemKey={(story) => String(story.id)}
        sortColumnId={sortColumn}
        sortDirection="desc"
        onHeaderClick={(columnId) => {
          if (columnId === "score" || columnId === "comments" || columnId === "age") {
            setSortColumn((current) => (current === columnId ? null : columnId));
          }
        }}
        renderCell={(story, column, _index, rowState) => renderCell(story, column, rowState)}
        emptyStateTitle="No stories."
      />
      </PaneStatusBody>
    </Box>
  );
}
