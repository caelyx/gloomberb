import { useCallback, useMemo } from "react";
import {
  DataTableView,
  EmptyState,
  PaneStatusBody,
  StatGrid,
  statGridRows,
  usePaneStatusFooter,
  type DataTableCell,
  type DataTableColumn,
  type StatItem,
} from "gloomberb/components";
import { useAssetData, useAsyncResource, useAutoRefresh, usePaneTickerIdentity } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import type { TickerResearchTabProps } from "gloomberb/types/plugin";
import { Box } from "gloomberb/ui";
import { asxCodeForTicker } from "../shared/asx";
import { loadFranking } from "./client";
import { frankingCredit, grossedUpYield, grossUpFactor, type FrankingSnapshot } from "./model";
import { formatDay } from "../shared/time";

interface DividendRow {
  exDate: string;
  amount: number;
  /** Only the latest dividend has a known franking percentage. */
  frankingPercent: number | null;
}

type Column = DataTableColumn & { id: "exDate" | "amount" | "franking" | "credit" | "gross" };

const COLUMNS: Column[] = [
  { id: "exDate", label: "Ex-date", width: 11, align: "left" },
  { id: "amount", label: "Cash A$", width: 10, align: "right" },
  { id: "franking", label: "Franked", width: 8, align: "right" },
  { id: "credit", label: "Credit A$", width: 10, align: "right" },
  { id: "gross", label: "Gross A$", width: 10, align: "right" },
];

const KIND_LABEL: Record<FrankingSnapshot["kind"], string> = { final: "Final", interim: "Interim", special: "Special", other: "" };

function money(value: number | null): string {
  return value == null ? "—" : value.toFixed(value < 1 ? 4 : 3).replace(/0$/, "");
}

function percent(value: number | null, digits = 2): string {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export function frankingStats(snapshot: FrankingSnapshot, cashYield: number | null): StatItem[] {
  const franking = snapshot.frankingPercent;
  const credit = snapshot.amount != null && franking != null ? frankingCredit(snapshot.amount, franking) : null;
  const declared = snapshot.declaredAmount != null && snapshot.declaredCurrency
    ? `${snapshot.declaredCurrency} ${snapshot.declaredAmount.toFixed(2)} declared`
    : undefined;
  return [
    { id: "dividend", label: KIND_LABEL[snapshot.kind] ? `${KIND_LABEL[snapshot.kind]} dividend` : "Last dividend", value: snapshot.amount == null ? "—" : `A$${money(snapshot.amount)}`, detail: declared },
    { id: "franking", label: "Franked", value: franking == null ? "—" : `${Math.round(franking)}%`, tone: franking === 100 ? "positive" : franking === 0 ? "muted" : undefined },
    { id: "credit", label: "Credit", value: credit == null ? "—" : `A$${money(credit)}`, detail: "at 30%" },
    { id: "gross", label: "Grossed up", value: snapshot.amount == null || franking == null ? "—" : `A$${money(snapshot.amount * grossUpFactor(franking))}` },
    { id: "yield", label: "Cash yield", value: percent(cashYield) },
    { id: "gross-yield", label: "Gross yield", value: percent(grossedUpYield(cashYield, franking)) },
    { id: "ex", label: "Ex-date", value: formatDay(snapshot.exDate) },
    { id: "record", label: "Record date", value: formatDay(snapshot.recordDate) },
    { id: "pay", label: "Pay date", value: formatDay(snapshot.payDate) },
  ];
}

/** The Franking tab of Ticker Research, for ASX equities. */
export function FrankingTab({ width, height, focused }: TickerResearchTabProps) {
  const { symbol, ticker } = usePaneTickerIdentity();
  const code = asxCodeForTicker(ticker, symbol);
  if (!code) return <EmptyState title="Franking is for ASX listings." />;
  return <CompanyFrankingTab key={code} code={code} width={width} height={height} focused={focused} />;
}

function CompanyFrankingTab({ code, width, height, focused }: Pick<TickerResearchTabProps, "width" | "height" | "focused"> & { code: string }) {
  const assetData = useAssetData();
  const loader = useCallback(async (force: boolean) => {
    const [snapshot, actions] = await Promise.all([
      loadFranking(code, { force }),
      // History is the host's; a failure there still leaves the latest dividend.
      Promise.resolve(assetData?.getCorporateActions?.(code, "ASX")).catch(() => null),
    ]);
    return { snapshot, dividends: actions?.dividends ?? [] };
  }, [assetData, code]);
  const { data, loading, error, updatedAt, load } = useAsyncResource(loader);
  useAutoRefresh(updatedAt, load);

  usePaneStatusFooter({ registrationId: "au-franking-tab", loading: loading && !!data, error: data ? error : null });

  const rows = useMemo<DividendRow[]>(() => {
    if (!data) return [];
    return [...data.dividends]
      .sort((a, b) => b.exDate.localeCompare(a.exDate))
      .slice(0, 20)
      .map((dividend) => ({
        exDate: dividend.exDate,
        amount: dividend.amount,
        frankingPercent: dividend.exDate === data.snapshot.exDate ? data.snapshot.frankingPercent : null,
      }));
  }, [data]);

  const stats = useMemo(() => {
    if (!data) return [];
    // ASX's annual yield is on the last close, the same basis as the host's quote.
    return frankingStats(data.snapshot, data.snapshot.annualYield);
  }, [data]);

  const renderCell = useCallback((row: DividendRow, column: Column): DataTableCell => {
    const franking = row.frankingPercent;
    switch (column.id) {
      case "exDate": return { text: formatDay(row.exDate), value: row.exDate, color: colors.textMuted };
      case "amount": return { text: money(row.amount), value: row.amount };
      case "franking": return { text: franking == null ? "" : `${Math.round(franking)}%`, value: franking };
      case "credit": return franking == null ? { text: "", value: null } : { text: money(frankingCredit(row.amount, franking)), value: frankingCredit(row.amount, franking) };
      case "gross": return franking == null ? { text: "", value: null } : { text: money(row.amount * grossUpFactor(franking)), value: row.amount * grossUpFactor(franking), color: colors.textBright };
    }
  }, []);

  if (!data) {
    return loading || !error
      ? <PaneStatusBody loading align="center" loadingLabel={`Loading ${code} dividends...`} />
      : <PaneStatusBody error={error} errorTitle={`${code} dividends unavailable.`} />;
  }

  const statRows = statGridRows(stats, width);
  return (
    <Box flexDirection="column" width={width} height={height}>
      <StatGrid items={stats} width={width} />
      <DataTableView<DividendRow, Column>
        focused={focused}
        rootWidth={width}
        rootHeight={Math.max(1, height - statRows)}
        selection={{ kind: "none" }}
        columns={COLUMNS}
        items={rows}
        sortColumnId={null}
        sortDirection="desc"
        getItemKey={(row) => row.exDate}
        renderCell={renderCell}
        emptyStateTitle="No dividend history."
      />
    </Box>
  );
}
