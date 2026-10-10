import { colors } from "gloomberb/theme";

export function formatPercent(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(2)}%`;
}

/** Percentage points, signed. */
export function formatPoints(value: number | null | undefined): string {
  if (value == null) return "—";
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}`;
}

/** More shorting reads as negative for the stock. */
export function pointsColor(value: number | null | undefined): string {
  if (value == null || Math.abs(value) < 0.005) return colors.textDim;
  return value > 0 ? colors.negative : colors.positive;
}

export function formatCount(value: number | null | undefined): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return String(value);
}
