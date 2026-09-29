export type ScopeAirport = { eu261Scope: boolean };
export type Scope = "yes" | "no" | "unknown";

/**
 * Art. 3.1: flights departing an EU/IS/NO/CH airport (any airline), or arriving there
 * from a third country on an EU carrier.
 */
export function inScope(input: {
  departure: ScopeAirport | null;
  arrival: ScopeAirport | null;
  isEuCarrier: boolean | null;
}): Scope {
  const { departure, arrival, isEuCarrier } = input;
  if (!departure) return "unknown";
  if (departure.eu261Scope) return "yes";
  if (!arrival) return "unknown";
  if (!arrival.eu261Scope) return "no";
  if (isEuCarrier === null) return "unknown";
  return isEuCarrier ? "yes" : "no";
}
