import { describe, expect, it } from "vitest";
import {
  addMonths,
  aesaAvailable,
  aesaDeadline,
  airlineReplyDue,
  claimLimitDate,
  compensationBand,
  evaluateEligibility,
  greatCircleKm,
  inScope,
  type EligibilityAirport,
  type EligibilityInput,
} from ".";

type Airport = EligibilityAirport & { latitude: number; longitude: number };
const BCN: Airport = { iata: "BCN", latitude: 41.2974, longitude: 2.0833, eu261Scope: true };
const MAD: Airport = { iata: "MAD", latitude: 40.4719, longitude: -3.5626, eu261Scope: true };
const HEL: Airport = { iata: "HEL", latitude: 60.3172, longitude: 24.9633, eu261Scope: true };
const TFS: Airport = { iata: "TFS", latitude: 28.0445, longitude: -16.5725, eu261Scope: true };
const JFK: Airport = { iata: "JFK", latitude: 40.6398, longitude: -73.7789, eu261Scope: false };
const TLV: Airport = { iata: "TLV", latitude: 32.0114, longitude: 34.8867, eu261Scope: false };

const base: EligibilityInput = {
  disruption: "delay",
  departure: BCN,
  finalDestination: MAD,
  isEuCarrier: true,
  flightDate: "2026-09-01",
  today: "2026-09-29",
  arrivalDelayMinutes: 200,
  cancellationNoticeDays: null,
  rerouting: null,
  reasonCategory: null,
  eligiblePassengers: 1,
};
const evaluate = (patch: Partial<EligibilityInput>) => evaluateEligibility({ ...base, ...patch });

describe("greatCircleKm", () => {
  it("matches known routes within 1%", () => {
    expect(greatCircleKm(BCN, MAD)).toBeGreaterThan(475);
    expect(greatCircleKm(BCN, MAD)).toBeLessThan(490);
    expect(greatCircleKm(BCN, JFK)).toBeGreaterThan(6100);
    expect(greatCircleKm(BCN, JFK)).toBeLessThan(6200);
  });
  it("is symmetric and zero for the same airport", () => {
    expect(greatCircleKm(BCN, HEL)).toBe(greatCircleKm(HEL, BCN));
    expect(greatCircleKm(BCN, BCN)).toBe(0);
  });
});

describe("compensationBand", () => {
  it("uses ≤1500 km for the short band", () => {
    expect(compensationBand(1500, false)).toBe("short");
    expect(compensationBand(1501, false)).toBe("medium");
  });
  it("uses 1500–3500 km for the medium band", () => {
    expect(compensationBand(3500, false)).toBe("medium");
    expect(compensationBand(3501, false)).toBe("long");
  });
  it("caps intra-EU flights at the medium band", () => {
    expect(compensationBand(3600, true)).toBe("medium");
    expect(compensationBand(1400, true)).toBe("short");
  });
});

describe("inScope", () => {
  const eu = { eu261Scope: true };
  const nonEu = { eu261Scope: false };
  it("covers any airline departing the EU", () => {
    expect(inScope({ departure: eu, arrival: nonEu, isEuCarrier: false })).toBe("yes");
  });
  it("covers arrivals into the EU only on EU carriers", () => {
    expect(inScope({ departure: nonEu, arrival: eu, isEuCarrier: true })).toBe("yes");
    expect(inScope({ departure: nonEu, arrival: eu, isEuCarrier: false })).toBe("no");
    expect(inScope({ departure: nonEu, arrival: eu, isEuCarrier: null })).toBe("unknown");
  });
  it("excludes flights between third countries", () => {
    expect(inScope({ departure: nonEu, arrival: nonEu, isEuCarrier: true })).toBe("no");
  });
  it("is unknown without airport data", () => {
    expect(inScope({ departure: null, arrival: eu, isEuCarrier: true })).toBe("unknown");
  });
});

describe("delay: 3h boundary at the final destination", () => {
  it("179 minutes is not enough", () => {
    const r = evaluate({ arrivalDelayMinutes: 179 });
    expect(r.verdict).toBe("unlikely");
    expect(r.reasons).toContain("delay_under_threshold");
    expect(r.totalEur).toBeNull();
  });
  it("180 minutes qualifies", () => {
    const r = evaluate({ arrivalDelayMinutes: 180 });
    expect(r.verdict).toBe("likely");
    expect(r.band).toBe("short");
    expect(r.perPassengerEur).toBe(250);
  });
  it("missing delay is unknown, not rejected", () => {
    expect(evaluate({ arrivalDelayMinutes: null }).verdict).toBe("unknown");
  });
  it("applies to missed connections via the final destination", () => {
    const r = evaluate({ disruption: "missed_connection", finalDestination: HEL, arrivalDelayMinutes: 185 });
    expect(r.verdict).toBe("likely");
    expect(r.perPassengerEur).toBe(400);
  });
});

describe("amounts", () => {
  it("pays €400 for long intra-EU flights (BCN–Tenerife is ~2200 km)", () => {
    expect(evaluate({ finalDestination: TFS }).perPassengerEur).toBe(400);
  });
  it("pays €600 for >3500 km non intra-EU with 4h+ delay", () => {
    const r = evaluate({ finalDestination: JFK, arrivalDelayMinutes: 240 });
    expect(r.band).toBe("long");
    expect(r.perPassengerEur).toBe(600);
  });
  it("halves long-haul compensation for 3–4h delays", () => {
    const r = evaluate({ finalDestination: JFK, arrivalDelayMinutes: 200 });
    expect(r.flags).toContain("long_haul_reduction");
    expect(r.perPassengerEur).toBe(300);
  });
  it("multiplies by passengers with paid tickets", () => {
    expect(evaluate({ finalDestination: TLV, eligiblePassengers: 3 }).totalEur).toBe(1200);
  });
});

describe("cancellation notice rules", () => {
  const cancel = (patch: Partial<EligibilityInput>) =>
    evaluate({ disruption: "cancellation", arrivalDelayMinutes: null, ...patch });

  it("≥14 days notice: no compensation", () => {
    expect(cancel({ cancellationNoticeDays: 14 }).verdict).toBe("unlikely");
  });
  it("<14 days without rerouting: compensation", () => {
    expect(cancel({ cancellationNoticeDays: 13 }).verdict).toBe("likely");
  });
  it("7–13 days with rerouting inside Art. 5.1(c)(ii): no compensation", () => {
    const r = cancel({
      cancellationNoticeDays: 10,
      rerouting: { offered: true, earlierDepartureMinutes: 120, laterArrivalMinutes: 239 },
    });
    expect(r.verdict).toBe("unlikely");
    expect(r.reasons).toContain("rerouting_within_limits");
  });
  it("7–13 days with rerouting arriving 4h+ late: compensation", () => {
    const r = cancel({
      cancellationNoticeDays: 7,
      rerouting: { offered: true, earlierDepartureMinutes: 0, laterArrivalMinutes: 240 },
    });
    expect(r.verdict).toBe("likely");
  });
  it("<7 days uses the stricter 1h / 2h limits", () => {
    const inside = cancel({
      cancellationNoticeDays: 6,
      rerouting: { offered: true, earlierDepartureMinutes: 60, laterArrivalMinutes: 119 },
    });
    expect(inside.verdict).toBe("unlikely");
    const outside = cancel({
      cancellationNoticeDays: 6,
      rerouting: { offered: true, earlierDepartureMinutes: 90, laterArrivalMinutes: 30 },
    });
    expect(outside.verdict).toBe("likely");
    expect(outside.flags).toContain("rerouting_reduction");
    expect(outside.perPassengerEur).toBe(125);
  });
  it("rerouting with missing times is only 'possible'", () => {
    const r = cancel({
      cancellationNoticeDays: 3,
      rerouting: { offered: true, earlierDepartureMinutes: null, laterArrivalMinutes: null },
    });
    expect(r.verdict).toBe("possible");
  });
  it("unknown notice is unknown", () => {
    expect(cancel({ cancellationNoticeDays: null }).verdict).toBe("unknown");
  });
});

describe("scope, flags and deadlines in the verdict", () => {
  it("flags possible extraordinary circumstances without rejecting", () => {
    const r = evaluate({ reasonCategory: "weather" });
    expect(r.verdict).toBe("possible");
    expect(r.flags).toContain("extraordinary_possible");
    expect(r.perPassengerEur).toBe(250);
  });
  it("technical faults are not flagged", () => {
    expect(evaluate({ reasonCategory: "technical" }).flags).not.toContain("extraordinary_possible");
  });
  it("rejects arrivals into the EU on non-EU carriers", () => {
    expect(evaluate({ departure: JFK, finalDestination: BCN, isEuCarrier: false }).verdict).toBe("unlikely");
  });
  it("marks claims older than 5 years", () => {
    const r = evaluate({ flightDate: "2021-09-01", today: "2026-09-02" });
    expect(r.reasons).toContain("claim_period_expired");
    expect(r.verdict).toBe("unlikely");
  });
  it("denied boarding is likely but flags the voluntary exception", () => {
    const r = evaluate({ disruption: "denied_boarding", arrivalDelayMinutes: null });
    expect(r.verdict).toBe("likely");
    expect(r.flags).toContain("denied_boarding_voluntary");
  });
});

describe("deadlines", () => {
  it("adds months with month-end clamping", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });
  it("computes the airline, AESA and limitation dates", () => {
    expect(airlineReplyDue("2026-09-29")).toBe("2026-10-29");
    expect(aesaDeadline("2026-09-29")).toBe("2027-09-29");
    expect(claimLimitDate("2026-09-01")).toBe("2031-09-01");
  });
  it("AESA ADR covers flights from 2 June 2023", () => {
    expect(aesaAvailable("2023-06-01")).toBe(false);
    expect(aesaAvailable("2023-06-02")).toBe(true);
  });
});
