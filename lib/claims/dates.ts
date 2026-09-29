/** Today's date in Spain (the legal deadlines are Spanish), as YYYY-MM-DD. */
export function todayInMadrid(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(now);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` has passed. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000);
}
