// EU261 as applied in Spain (Sept 2026). Kept in config: the reform agreed in June 2026
// is expected to change thresholds, amounts and deadlines from ~2027.
export const EU261 = {
  compensationEur: { short: 250, medium: 400, long: 600 },
  bandsKm: { short: 1500, medium: 3500 },
  // Sturgeon: arrival delay at the final destination (doors open).
  minArrivalDelayMinutes: 180,
  // Art. 7.2 / Sturgeon: >3500 km (non intra-EU) with a 3–4h delay may be halved.
  longHaulReductionMaxDelayMinutes: 240,
  // Art. 7.2: rerouted arrival within these minutes of schedule halves compensation.
  reroutingReductionMinutes: { short: 120, medium: 180, long: 240 },
  cancellation: {
    fullNoticeDays: 14,
    midNoticeDays: 7,
    // Art. 5.1(c)(ii): notified 7–14 days before.
    reroutingMid: { maxEarlierDepartureMinutes: 120, maxLaterArrivalMinutes: 240 },
    // Art. 5.1(c)(iii): notified < 7 days before.
    reroutingShort: { maxEarlierDepartureMinutes: 60, maxLaterArrivalMinutes: 120 },
  },
  deadlines: {
    claimYears: 5, // Spain: limitation period for the airline claim
    airlineReplyMonths: 1,
    aesaMonthsAfterAirlineClaim: 12,
    aesaMinFlightDate: "2023-06-02", // AESA binding ADR applies to flights from this date
  },
  // Reasons that may amount to extraordinary circumstances: flagged, never auto-rejected.
  possiblyExtraordinaryReasons: ["weather", "atc", "security", "external_strike"],
} as const;

// Must mirror compute_fee_pct() in the database. VAT included, applied to compensation only.
export const FEE = { basePct: 15, minPct: 10 } as const;
