import { EU261 } from "./config";

/** Adds calendar months to an ISO date (YYYY-MM-DD), clamping to the month's last day. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Last day to file the claim with the airline. */
export function claimLimitDate(flightDate: string): string {
  return addMonths(flightDate, EU261.deadlines.claimYears * 12);
}

/** The airline must answer within one month of the claim. */
export function airlineReplyDue(submittedDate: string): string {
  return addMonths(submittedDate, EU261.deadlines.airlineReplyMonths);
}

/** Last day to go to AESA (binding ADR), counted from the airline claim. */
export function aesaDeadline(submittedDate: string): string {
  return addMonths(submittedDate, EU261.deadlines.aesaMonthsAfterAirlineClaim);
}

export function aesaAvailable(flightDate: string): boolean {
  return flightDate >= EU261.deadlines.aesaMinFlightDate;
}
