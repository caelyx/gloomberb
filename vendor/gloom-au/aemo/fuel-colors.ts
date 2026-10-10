import { blendHex, colors } from "gloomberb/theme";

/**
 * One colour per fuel, from the theme's tokens so every theme keeps its
 * contrast, picked to match the usual energy-chart conventions: coal grey
 * and brown, gas orange, hydro blue (the accent), wind green, solar yellow,
 * battery purple so it stands out against price. With an OpenElectricity
 * key, rooftop solar is a paler yellow beside utility solar and battery
 * charging a duller purple beside discharge. docs/nem.md lists them.
 */
export function fuelColor(fuel: string): string {
  switch (fuel) {
    case "black-coal": return colors.textDim;
    case "brown-coal": return blendHex(blendHex(colors.warning, colors.negative, 0.35), colors.textMuted, 0.45);
    case "gas": return blendHex(colors.warning, colors.negative, 0.5);
    case "liquid": return colors.negative;
    case "hydro": return colors.borderFocused;
    case "biomass": return blendHex(colors.positive, colors.textMuted, 0.55);
    case "wind": return colors.positive;
    case "solar": return colors.warning;
    case "rooftop": return blendHex(colors.warning, colors.textBright, 0.45);
    case "battery": return blendHex(colors.borderFocused, colors.negative, 0.5);
    case "battery-charging": return blendHex(blendHex(colors.borderFocused, colors.negative, 0.5), colors.textMuted, 0.45);
    default: return colors.textMuted;
  }
}

/** The spot price wherever it is drawn with the mix. */
export function priceLineColor(): string {
  return colors.textBright;
}
