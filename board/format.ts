import { colors } from "gloomberb/theme";

/** A signed percentage; a move that rounds to zero prints unsigned, never "-0.00%". */
export function pct(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return `${(0).toFixed(digits)}%`;
  return `${rounded > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function level(value: number | null | undefined): string {
  if (value == null) return "—";
  return value >= 1000 ? value.toLocaleString("en-AU", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : value.toFixed(2);
}

export function toneColor(value: number | null | undefined): string {
  if (value == null || Math.abs(value) < 0.005) return colors.textDim;
  return value > 0 ? colors.positive : colors.negative;
}

export function capLabel(value: number | null): string {
  if (value == null) return "—";
  return value >= 1e9 ? `A$${(value / 1e9).toFixed(value >= 1e11 ? 0 : 1)}B` : `A$${(value / 1e6).toFixed(0)}M`;
}
