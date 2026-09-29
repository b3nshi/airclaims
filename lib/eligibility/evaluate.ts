import { bandAmountEur, compensationBand, type Band } from "./band";
import { EU261 } from "./config";
import { claimLimitDate } from "./deadlines";
import { greatCircleKm } from "./distance";
import { inScope } from "./scope";

export type Disruption = "delay" | "cancellation" | "denied_boarding" | "missed_connection";

export type EligibilityAirport = {
  iata: string;
  latitude: number | null;
  longitude: number | null;
  eu261Scope: boolean;
};

export type Rerouting = {
  offered: boolean;
  earlierDepartureMinutes: number | null; // how much earlier the alternative left
  laterArrivalMinutes: number | null; // how much later it arrived at the final destination
};

export type EligibilityInput = {
  disruption: Disruption;
  departure: EligibilityAirport | null;
  finalDestination: EligibilityAirport | null;
  isEuCarrier: boolean | null;
  flightDate: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD, injected for testability
  arrivalDelayMinutes: number | null;
  cancellationNoticeDays: number | null;
  rerouting: Rerouting | null;
  reasonCategory: string | null;
  eligiblePassengers: number; // paid tickets only
};

export type Verdict = "likely" | "possible" | "unlikely" | "unknown";

export type ReasonCode =
  | "claim_period_expired"
  | "out_of_scope"
  | "scope_unknown"
  | "delay_unknown"
  | "delay_under_threshold"
  | "delay_over_threshold"
  | "notice_unknown"
  | "notice_14_days"
  | "rerouting_within_limits"
  | "rerouting_details_missing"
  | "cancellation_late_notice"
  | "denied_boarding";

export type FlagCode =
  | "extraordinary_possible"
  | "long_haul_reduction"
  | "rerouting_reduction"
  | "distance_unknown"
  | "denied_boarding_voluntary";

export type EligibilityResult = {
  verdict: Verdict;
  reasons: ReasonCode[];
  flags: FlagCode[];
  distanceKm: number | null;
  band: Band | null;
  perPassengerEur: number | null;
  totalEur: number | null;
};

const hasCoords = (a: EligibilityAirport | null): a is EligibilityAirport & { latitude: number; longitude: number } =>
  a !== null && a.latitude !== null && a.longitude !== null;

/**
 * Estimate only. Never used to reject a claim automatically: "unlikely" is shown to
 * the user with its reasons, and flags are surfaced for them (and us) to review.
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: ReasonCode[] = [];
  const flags: FlagCode[] = [];

  const distanceKm =
    hasCoords(input.departure) && hasCoords(input.finalDestination)
      ? greatCircleKm(input.departure, input.finalDestination)
      : null;
  const intraEu = Boolean(input.departure?.eu261Scope && input.finalDestination?.eu261Scope);
  const band = distanceKm === null ? null : compensationBand(distanceKm, intraEu);
  if (distanceKm === null) flags.push("distance_unknown");

  if (input.reasonCategory && (EU261.possiblyExtraordinaryReasons as readonly string[]).includes(input.reasonCategory)) {
    flags.push("extraordinary_possible");
  }

  let verdict: Verdict = "likely";
  let halved = false;
  const downgrade = (v: Verdict) => {
    const order: Verdict[] = ["likely", "possible", "unknown", "unlikely"];
    if (order.indexOf(v) > order.indexOf(verdict)) verdict = v;
  };

  if (input.today > claimLimitDate(input.flightDate)) {
    reasons.push("claim_period_expired");
    downgrade("unlikely");
  }

  const scope = inScope({
    departure: input.departure,
    arrival: input.finalDestination,
    isEuCarrier: input.isEuCarrier,
  });
  if (scope === "no") {
    reasons.push("out_of_scope");
    downgrade("unlikely");
  } else if (scope === "unknown") {
    reasons.push("scope_unknown");
    downgrade("unknown");
  }

  switch (input.disruption) {
    case "delay":
    case "missed_connection": {
      const delay = input.arrivalDelayMinutes;
      if (delay === null) {
        reasons.push("delay_unknown");
        downgrade("unknown");
      } else if (delay < EU261.minArrivalDelayMinutes) {
        reasons.push("delay_under_threshold");
        downgrade("unlikely");
      } else {
        reasons.push("delay_over_threshold");
        if (band === "long" && delay < EU261.longHaulReductionMaxDelayMinutes) {
          flags.push("long_haul_reduction");
          halved = true;
        }
      }
      break;
    }
    case "cancellation": {
      const notice = input.cancellationNoticeDays;
      const c = EU261.cancellation;
      if (notice === null) {
        reasons.push("notice_unknown");
        downgrade("unknown");
        break;
      }
      if (notice >= c.fullNoticeDays) {
        reasons.push("notice_14_days");
        downgrade("unlikely");
        break;
      }
      reasons.push("cancellation_late_notice");
      const r = input.rerouting;
      if (!r?.offered) break;
      if (r.earlierDepartureMinutes === null || r.laterArrivalMinutes === null) {
        reasons.push("rerouting_details_missing");
        downgrade("possible");
        break;
      }
      const limits = notice >= c.midNoticeDays ? c.reroutingMid : c.reroutingShort;
      if (
        r.earlierDepartureMinutes <= limits.maxEarlierDepartureMinutes &&
        r.laterArrivalMinutes < limits.maxLaterArrivalMinutes
      ) {
        reasons.push("rerouting_within_limits");
        downgrade("unlikely");
        break;
      }
      if (band && r.laterArrivalMinutes <= EU261.reroutingReductionMinutes[band]) {
        flags.push("rerouting_reduction");
        halved = true;
      }
      break;
    }
    case "denied_boarding":
      reasons.push("denied_boarding");
      flags.push("denied_boarding_voluntary");
      break;
  }

  if (flags.includes("extraordinary_possible") && verdict === "likely") verdict = "possible";

  const perPassengerEur =
    band && (verdict === "likely" || verdict === "possible") ? bandAmountEur(band) * (halved ? 0.5 : 1) : null;
  const totalEur = perPassengerEur === null ? null : perPassengerEur * Math.max(0, input.eligiblePassengers);

  return { verdict, reasons, flags, distanceKm, band, perPassengerEur, totalEur };
}
