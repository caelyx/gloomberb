// The only formatter for dataset values (brief D16a). Storage is SI: errors
// as fractions, times in seconds. JSON/CSV output stays raw; every pane and
// the CLI's text output come through here.

export type ErrorFormat = "auto" | "percent" | "exponent" | "fidelity";
export const ERROR_FORMATS: readonly ErrorFormat[] = ["auto", "percent", "exponent", "fidelity"];

export interface ErrorFormatOptions {
  /** `ascii` (`10^-4`) for the terminal; `unicode` (`10⁻⁴`) where superscripts render. */
  exponentStyle?: "ascii" | "unicode";
}

const MISSING = "—";
const MAX_SIG = 5;
const MAX_PERCENT_DECIMALS = 5;

/** A positive decimal as its significant digits and the exponent of the first one. */
interface Decimal {
  digits: string;
  exp: number;
}

/**
 * Rounds the shortest decimal form of `value` (what was typed into the YAML)
 * half-up to `maxSig` digits. `toPrecision` would round the binary value
 * instead, turning 9.98765e-4 into 9.9876.
 */
function decompose(value: number, maxSig = MAX_SIG): Decimal {
  const [mantissa, expText] = value.toExponential().split("e");
  let digits = mantissa!.replace(".", "");
  let exp = Number(expText);
  if (digits.length > maxSig) {
    const roundUp = Number(digits[maxSig]) >= 5;
    let kept = BigInt(digits.slice(0, maxSig)) + (roundUp ? 1n : 0n);
    if (kept.toString().length > maxSig) {
      kept /= 10n;
      exp += 1;
    }
    digits = kept.toString();
  }
  return { digits: digits.replace(/0+$/, "") || "0", exp };
}

function sigDigits(value: number): number {
  return decompose(value, 21).digits.length;
}

/** Plain decimal text of `d × 10^shift`, and its number of decimal places. */
function toPlain({ digits, exp }: Decimal, shift = 0): { text: string; decimals: number } {
  const e = exp + shift;
  if (e < 0) {
    const fraction = "0".repeat(-e - 1) + digits;
    return { text: `0.${fraction}`, decimals: fraction.length };
  }
  const whole = digits.slice(0, e + 1).padEnd(e + 1, "0");
  const fraction = digits.slice(e + 1);
  return { text: fraction ? `${whole}.${fraction}` : whole, decimals: fraction.length };
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const SUPERSCRIPT: Record<string, string> = {
  "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

function exponentText(value: number, style: "ascii" | "unicode"): string {
  const { digits, exp } = decompose(value);
  const power = style === "unicode"
    ? `10${[...String(exp)].map((c) => SUPERSCRIPT[c]).join("")}`
    : `10^${exp}`;
  if (digits === "1") return power;
  const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${mantissa}×${power}`;
}

function percentText(value: number): { text: string; decimals: number } {
  return toPlain(decompose(value), 2);
}

function fidelityText(value: number): string {
  const { text, decimals } = percentText(value);
  const scale = 10n ** BigInt(decimals);
  const errorUnits = BigInt(text.replace(".", ""));
  const fidelityUnits = 100n * scale - errorUnits;
  const whole = (fidelityUnits / scale).toString();
  const fraction = (fidelityUnits % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} %` : `${whole} %`;
}

function isMissing(value: number | null | undefined): value is null | undefined {
  return value === null || value === undefined || !Number.isFinite(value) || value < 0;
}

/**
 * An error rate (a fraction) for display. `auto` is a percentage when the
 * stored value has at most five significant digits and its percentage needs
 * at most five decimal places; otherwise powers of ten.
 */
export function fmtError(
  value: number | null | undefined,
  format: ErrorFormat = "auto",
  options: ErrorFormatOptions = {},
): string {
  if (isMissing(value)) return MISSING;
  if (value === 0) return format === "exponent" ? "0" : format === "fidelity" ? "100 %" : "0 %";
  const style = options.exponentStyle ?? "ascii";
  switch (format) {
    case "percent":
      return `${percentText(value).text} %`;
    case "exponent":
      return exponentText(value, style);
    case "fidelity":
      return fidelityText(value);
    case "auto": {
      const percent = percentText(value);
      const fits = sigDigits(value) <= MAX_SIG && percent.decimals <= MAX_PERCENT_DECIMALS;
      return fits ? `${percent.text} %` : exponentText(value, style);
    }
  }
}

/** Column header for an error column under the chosen format. */
export function errorHeader(base: string, format: ErrorFormat): string {
  return format === "fidelity" ? `${base} fidelity` : `${base} err`;
}

function compactNumber(value: number): string {
  if (value >= 100) return groupThousands(String(Math.round(value)));
  const { text } = toPlain(decompose(value, value < 1 ? 2 : 3));
  const [whole, fraction] = text.split(".");
  return fraction ? `${groupThousands(whole!)}.${fraction}` : groupThousands(whole!);
}

/**
 * A duration in seconds for display: microseconds (`us`, never `µs`) below
 * 0.1 s, seconds above. Sub-microsecond values keep two significant digits.
 */
export function fmtTime(seconds: number | null | undefined): string {
  if (isMissing(seconds)) return MISSING;
  if (seconds === 0) return "0 us";
  const micro = seconds * 1e6;
  if (Math.round(micro) < 100_000) return `${compactNumber(micro)} us`;
  return `${compactNumber(seconds)} s`;
}

export function fmtCount(value: number | null | undefined): string {
  if (isMissing(value)) return MISSING;
  return groupThousands(String(Math.round(value)));
}

function twoSig(value: number): string {
  return compactSig(value, 2);
}

function compactSig(value: number, sig: number): string {
  const { text } = toPlain(decompose(value, sig));
  const [whole, fraction] = text.split(".");
  return fraction ? `${groupThousands(whole!)}.${fraction}` : groupThousands(whole!);
}

/** A ratio such as a gap (`×5,100`), to two significant figures. */
export function fmtRatio(value: number | null | undefined): string {
  if (isMissing(value)) return MISSING;
  return `×${twoSig(value)}`;
}

/** Each unit's size in seconds, and the rounded count at which the next unit takes over. */
const RUNTIME_UNITS: ReadonlyArray<readonly [number, string, number]> = [[1, "s", 60], [60, "min", 60], [3600, "h", 24]];

/** A long runtime (an algorithm's wall-clock time) in s, min, h or days, two significant figures. */
export function fmtRuntime(seconds: number | null | undefined): string {
  if (isMissing(seconds)) return MISSING;
  // Rounded before the unit is chosen, so 59.9 s reads "1 min", never "60 s".
  for (const [size, unit, next] of RUNTIME_UNITS) {
    if (Number((seconds / size).toPrecision(2)) < next) return `${twoSig(seconds / size)} ${unit}`;
  }
  const days = seconds / 86400;
  return `${twoSig(days)} ${Number(days.toPrecision(2)) === 1 ? "day" : "days"}`;
}
