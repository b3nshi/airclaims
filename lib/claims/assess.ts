import "server-only";
import { evaluateEligibility, type EligibilityAirport } from "@/lib/eligibility";
import type { AirportRow, ClaimRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { decodeReason, parseCare } from "./model";

const toEligibilityAirport = (a: AirportRow | undefined): EligibilityAirport | null =>
  a ? { iata: a.iata, latitude: a.latitude, longitude: a.longitude, eu261Scope: a.eu261_scope } : null;

export const airportLabel = (a: Pick<AirportRow, "iata" | "city" | "name"> | undefined, iata: string | null) =>
  a ? `${a.city || a.name} (${a.iata})` : (iata ?? "—");

/** Everything the review / sign / done steps need, loaded through RLS. */
export async function assessClaim(claim: ClaimRow) {
  const supabase = await createClient();
  const finalIata = claim.final_destination_iata ?? claim.arr_iata;
  const iatas = [...new Set([claim.dep_iata, claim.arr_iata, finalIata].filter((x): x is string => !!x))];

  const [airportsRes, airlineRes, paxRes, expensesRes, docsRes, flagsRes, feeRes, flightRes] = await Promise.all([
    iatas.length ? supabase.from("airports").select("*").in("iata", iatas) : Promise.resolve({ data: [], error: null }),
    claim.airline_id
      ? supabase.from("airlines").select("*").eq("id", claim.airline_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("claim_passengers").select("*").eq("claim_id", claim.id).order("is_lead", { ascending: false }),
    supabase.from("claim_expenses").select("*").eq("claim_id", claim.id).order("spent_at"),
    supabase.from("documents").select("id, doc_type").eq("claim_id", claim.id),
    claim.flight_id
      ? supabase.from("flight_risk_flags").select("*").eq("flight_id", claim.flight_id)
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc("compute_fee_pct", { p_claim_id: claim.id }),
    claim.flight_id
      ? supabase.from("flights").select("*").eq("id", claim.flight_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [airportsRes, airlineRes, paxRes, expensesRes, docsRes, flagsRes, feeRes, flightRes]) if (r.error) throw r.error;

  const airports = new Map((airportsRes.data ?? []).map((a) => [a.iata, a]));
  const airline = airlineRes.data;
  const passengers = paxRes.data ?? [];
  const paidPassengers = passengers.filter((p) => !p.is_infant_free);
  const care = parseCare(claim.care_provided);
  const reason = decodeReason(claim.reason_given_by_airline);
  const departure = claim.dep_iata ? airports.get(claim.dep_iata) : undefined;

  const eligibility = evaluateEligibility({
    disruption: claim.disruption,
    departure: toEligibilityAirport(departure),
    finalDestination: toEligibilityAirport(finalIata ? airports.get(finalIata) : undefined),
    isEuCarrier: airline ? airline.is_eu_carrier : null,
    flightDate: claim.flight_date,
    today: new Date().toISOString().slice(0, 10),
    arrivalDelayMinutes: claim.reported_arrival_delay_minutes,
    cancellationNoticeDays: claim.cancellation_notice_days,
    rerouting: care.rerouting
      ? {
          offered: care.rerouting.offered,
          earlierDepartureMinutes: care.rerouting.earlier_departure_minutes,
          laterArrivalMinutes: care.rerouting.later_arrival_minutes,
        }
      : null,
    reasonCategory: reason.category,
    eligiblePassengers: paidPassengers.length,
  });

  const feePct = Number(feeRes.data ?? 15);
  return {
    eligibility,
    airline,
    passengers,
    paidPassengers,
    expenses: expensesRes.data ?? [],
    documents: docsRes.data ?? [],
    riskFlags: flagsRes.data ?? [],
    flight: flightRes.data, // our flight data, when linked (final or provisional)
    feePct,
    feeEur: eligibility.totalEur === null ? null : Math.round(eligibility.totalEur * feePct) / 100,
    labels: {
      departure: airportLabel(departure, claim.dep_iata),
      arrival: airportLabel(claim.arr_iata ? airports.get(claim.arr_iata) : undefined, claim.arr_iata),
      finalDestination: airportLabel(finalIata ? airports.get(finalIata) : undefined, finalIata),
    },
    departsSpain: departure?.country_code === "ES",
    care,
    reason,
  };
}

export type ClaimAssessment = Awaited<ReturnType<typeof assessClaim>>;
