import { EU261 } from "./config";

export type Band = "short" | "medium" | "long";

/**
 * Art. 7.1: ≤1500 km → short; intra-EU >1500 km or 1500–3500 km → medium; else long.
 * Distance is departure → final destination, not the sum of legs.
 */
export function compensationBand(distanceKm: number, intraEu: boolean): Band {
  if (distanceKm <= EU261.bandsKm.short) return "short";
  if (intraEu || distanceKm <= EU261.bandsKm.medium) return "medium";
  return "long";
}

export function bandAmountEur(band: Band): number {
  return EU261.compensationEur[band];
}
