// EU261 figures as applied in Spain. Kept in config: the 2026 reform may change them.
export const EU261 = {
  compensationEur: { short: 250, medium: 400, long: 600 },
  minArrivalDelayHours: 3,
} as const;

// Must mirror compute_fee_pct() in the database. VAT included, applied to compensation only.
export const FEE = { basePct: 15, minPct: 10 } as const;
