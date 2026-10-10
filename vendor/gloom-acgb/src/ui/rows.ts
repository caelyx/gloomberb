import type { CurveSeries } from "gloomberb/components";
import type { AcgbSnapshot, CurvePoint, CurveSession, LookbackId } from "../rba/curve";

export interface TenorRow {
  id: string;
  years: number;
  yield: number;
  change1d: number | null;
  change1w: number | null;
  change1m: number | null;
  /** The US Treasury par yield at this tenor, and this yield minus it. */
  us: number | null;
  spreadToUs: number | null;
}

export interface SpreadFigure {
  id: string;
  /** Long minus short, percentage points. */
  value: number;
  change1d: number | null;
}

const SPREADS = [
  { id: "2s10s", short: "2Y", long: "10Y" },
  { id: "5s30s", short: "5Y", long: "30Y" },
] as const;

/** The look-backs drawn as ghosts; the session before is a change, not a curve worth drawing. */
const GHOST_IDS: readonly LookbackId[] = ["1W", "1M"];

function yieldAt(session: CurveSession | null | undefined, tenor: string): number | null {
  return session?.points.find((point) => point.tenor === tenor)?.yield ?? null;
}

/** Only tenors the bond lines bracket; the rest have no yield to show. */
function quoted(points: readonly CurvePoint[]): Array<CurvePoint & { yield: number }> {
  return points.filter((point): point is CurvePoint & { yield: number } => point.yield != null);
}

export function tenorRows(snapshot: AcgbSnapshot, us: CurveSession | null = null): TenorRow[] {
  const change = (id: LookbackId, tenor: string, current: number) => {
    const past = yieldAt(snapshot.lookbacks[id], tenor);
    return past == null ? null : current - past;
  };
  return quoted(snapshot.latest.points).map((point) => {
    const usYield = yieldAt(us, point.tenor);
    return {
      id: point.tenor, years: point.years, yield: point.yield,
      change1d: change("1D", point.tenor, point.yield),
      change1w: change("1W", point.tenor, point.yield),
      change1m: change("1M", point.tenor, point.yield),
      us: usYield, spreadToUs: usYield == null ? null : point.yield - usYield,
    };
  });
}

/** The spreads both of whose tenors the latest session has. */
export function spreadFigures(snapshot: AcgbSnapshot): SpreadFigure[] {
  return SPREADS.flatMap(({ id, short, long }) => {
    const shortYield = yieldAt(snapshot.latest, short);
    const longYield = yieldAt(snapshot.latest, long);
    if (shortYield == null || longYield == null) return [];
    const beforeShort = yieldAt(snapshot.lookbacks["1D"], short);
    const beforeLong = yieldAt(snapshot.lookbacks["1D"], long);
    const value = longYield - shortYield;
    return [{ id, value, change1d: beforeShort == null || beforeLong == null ? null : value - (beforeLong - beforeShort) }];
  });
}

function series(session: CurveSession): CurveSeries["points"] {
  return quoted(session.points).map((point) => ({ id: point.tenor, label: point.tenor, x: point.years, value: point.yield }));
}

export interface CurveSeriesColors {
  current: string;
  ghosts: Readonly<Record<string, string>>;
  us: string;
}

/**
 * The ACGB curve, then either the US curve as points (its readout is the
 * spread at the tenor) or, without it, the week and month look-backs.
 */
export function curveSeries(snapshot: AcgbSnapshot, colors: CurveSeriesColors, us: CurveSession | null = null): CurveSeries[] {
  const primary: CurveSeries = { id: "acgb", label: "ACGB", asOf: snapshot.latest.date, color: colors.current, points: series(snapshot.latest) };
  if (us) return [primary, { id: "ust", label: "UST", role: "ghost", style: "points", color: colors.us, points: series(us) }];
  const ghosts = GHOST_IDS.flatMap((id): CurveSeries[] => {
    const session = snapshot.lookbacks[id];
    return session && quoted(session.points).length
      ? [{ id, label: id, role: "ghost", color: colors.ghosts[id], points: series(session) }]
      : [];
  });
  return [primary, ...ghosts];
}
