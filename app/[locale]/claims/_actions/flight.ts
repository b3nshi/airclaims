"use server";

import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { invalid, type FormState } from "@/lib/claims/form-state";
import { FLIGHT_NUMBER_RE, normalizeFlightNumber } from "@/lib/claims/model";
import { requestFlightCheck } from "@/lib/claims/flight-check";
import { instantToLocal } from "@/lib/claims/times";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { guardClaim } from "./guard";

const today = () => new Date().toISOString().slice(0, 10);
const iata = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const localTime = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), z.literal("")]);

const flightSchema = z
  .object({
    flight_iata: z.string().transform(normalizeFlightNumber).pipe(z.string().regex(FLIGHT_NUMBER_RE)),
    flight_date: z.iso.date().refine((d) => d <= today()),
    dep_iata: iata,
    arr_iata: iata,
    has_connection: z.boolean(),
    final_destination_iata: z.string().trim().toUpperCase(),
    booking_reference: z.string().trim().toUpperCase().max(12).regex(/^[A-Z0-9]*$/),
    flight_id: z.union([z.uuid(), z.literal("")]),
    airline_id: z.union([z.uuid(), z.literal("")]),
    scheduled_dep_time: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal("")]),
    scheduled_arr: localTime,
  })
  .refine((v) => v.dep_iata !== v.arr_iata, { path: ["arr_iata"] })
  .refine((v) => !v.has_connection || /^[A-Z]{3}$/.test(v.final_destination_iata), {
    path: ["final_destination_iata"],
  });

export async function saveFlight(
  locale: string,
  claimId: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = claimId ? (await guardClaim(locale, claimId, "draft")).user : await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });

  const parsed = flightSchema.safeParse({
    flight_iata: String(formData.get("flight_iata") ?? ""),
    flight_date: formData.get("flight_date"),
    dep_iata: formData.get("dep_iata"),
    arr_iata: formData.get("arr_iata"),
    has_connection: formData.get("has_connection") === "on",
    final_destination_iata: String(formData.get("final_destination_iata") ?? ""),
    booking_reference: String(formData.get("booking_reference") ?? ""),
    flight_id: String(formData.get("flight_id") ?? ""),
    airline_id: String(formData.get("airline_id") ?? ""),
    scheduled_dep_time: String(formData.get("scheduled_dep_time") ?? ""),
    scheduled_arr: String(formData.get("scheduled_arr") ?? ""),
  });
  if (!parsed.success) return invalid(parsed.error.issues);
  const v = parsed.data;
  const finalIata = v.has_connection ? v.final_destination_iata : null;

  const supabase = await createClient();
  const codes = [v.dep_iata, v.arr_iata, ...(finalIata ? [finalIata] : [])];
  const [airportsRes, airlineRes, flightRes] = await Promise.all([
    supabase.from("airports").select("iata").in("iata", codes),
    // The passenger's choice wins (codeshares, unknown codes); otherwise the flight number's prefix.
    v.airline_id
      ? supabase.from("airlines").select("id").eq("id", v.airline_id).maybeSingle()
      : supabase.from("airlines").select("id").eq("iata", v.flight_iata.slice(0, 2)).maybeSingle(),
    v.flight_id
      ? supabase.from("flights").select("id").eq("id", v.flight_id)
          .eq("flight_iata", v.flight_iata).eq("flight_date", v.flight_date).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (airportsRes.error || airlineRes.error || flightRes.error) return { status: "error" };
  const known = new Set((airportsRes.data ?? []).map((a) => a.iata));
  const fields = { dep_iata: v.dep_iata, arr_iata: v.arr_iata, final_destination_iata: finalIata };
  const unknown = Object.fromEntries(
    Object.entries(fields)
      .filter(([, code]) => code && !known.has(code))
      .map(([field]) => [field, true as const]),
  );
  if (Object.keys(unknown).length) return { status: "invalid", fieldErrors: unknown };

  const row = {
    flight_iata: v.flight_iata,
    flight_date: v.flight_date,
    dep_iata: v.dep_iata,
    arr_iata: v.arr_iata,
    final_destination_iata: finalIata,
    booking_reference: v.booking_reference || null,
    airline_id: airlineRes.data?.id ?? null,
    flight_id: flightRes.data?.id ?? null,
    reported_scheduled_dep_local: v.scheduled_dep_time ? `${v.flight_date}T${v.scheduled_dep_time}` : null,
    reported_scheduled_arr_local: v.scheduled_arr || null,
  };

  let id = claimId;
  if (id) {
    const { error } = await supabase.from("claims").update(row).eq("id", id);
    if (error) return { status: "error" };
  } else {
    const { data, error } = await supabase.from("claims").insert({ ...row, owner_id: user.id }).select("id").single();
    if (error || !data) return { status: "error" };
    id = data.id;
  }
  // Every claim is verified against our flight data (queued once per flight if unknown).
  await requestFlightCheck(v.flight_iata, v.flight_date);
  return redirect({ href: `/claims/${id}/disruption`, locale });
}

type LookupAirport = { iata: string; label: string } | null;
export type LookupResult =
  | {
      status: "found" | "checking";
      flightId: string | null;
      airline: { id: string; name: string } | null;
      dep: LookupAirport;
      arr: LookupAirport;
      // Local times at each airport, as datetime-local values.
      scheduledDep: string | null;
      scheduledArr: string | null;
      actualDep: string | null;
      actualArr: string | null;
      flightStatus: string | null;
      delayMinutes: number | null;
      cancelled: boolean;
    }
  | { status: "checking_no_data" | "not_found" | "unavailable" | "rate_limited" | "invalid" };

async function airportInfo(codes: (string | null)[]) {
  const wanted = codes.filter((c): c is string => !!c);
  const supabase = await createClient();
  const { data } = wanted.length
    ? await supabase.from("airports").select("iata, name, city, timezone").in("iata", wanted)
    : { data: [] };
  const find = (code: string | null) => data?.find((x) => x.iata === code);
  return {
    label: (code: string | null): LookupAirport => {
      const a = find(code);
      return code ? { iata: code, label: a ? `${a.city || a.name} (${a.iata})` : code } : null;
    },
    tz: (code: string | null) => find(code)?.timezone ?? null,
  };
}

/**
 * Checks a flight against our table. Final data answers immediately; otherwise the
 * flight is queued for a single API call and the client polls this action again
 * (polling never creates a second check).
 */
export async function checkFlight(flightNumber: string, flightDate: string): Promise<LookupResult> {
  if (!(await getCurrentUser())) return { status: "invalid" };
  const flight = normalizeFlightNumber(flightNumber);
  if (!FLIGHT_NUMBER_RE.test(flight) || !z.iso.date().safeParse(flightDate).success || flightDate > today()) {
    return { status: "invalid" };
  }

  const check = await requestFlightCheck(flight, flightDate);
  switch (check.status) {
    case "invalid":
    case "not_found":
    case "rate_limited":
      return { status: check.status };
    case "failed":
      return { status: "unavailable" };
  }
  const f = check.flight;
  if (!f?.dep_iata && !f?.arr_iata) return { status: "checking_no_data" };
  const [airports, airlineRes] = await Promise.all([
    airportInfo([f.dep_iata, f.arr_iata]),
    f.airline_id
      ? (await createClient()).from("airlines").select("id, name").eq("id", f.airline_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const at = (instant: string | null, code: string | null) => (instant ? instantToLocal(instant, airports.tz(code)) : null);
  return {
    status: check.status === "final" || f.data_status === "final" ? "found" : "checking",
    flightId: f.id,
    airline: airlineRes.data ?? null,
    dep: airports.label(f.dep_iata),
    arr: airports.label(f.arr_iata),
    scheduledDep: at(f.scheduled_dep, f.dep_iata),
    scheduledArr: at(f.scheduled_arr, f.arr_iata),
    actualDep: at(f.actual_dep, f.dep_iata),
    actualArr: at(f.actual_arr, f.arr_iata),
    flightStatus: f.status,
    delayMinutes: f.arrival_delay_minutes,
    cancelled: /^cancel/i.test(f.status ?? ""),
  };
}

export type AirportOption = { iata: string; name: string; city: string | null; country_code: string };

export async function searchAirports(query: string): Promise<AirportOption[]> {
  // Letters, digits, spaces and hyphens only: the value goes into a PostgREST filter.
  const q = query.normalize("NFC").replace(/[^\p{L}\p{N} -]/gu, "").trim().slice(0, 40);
  if (q.length < 2 || !(await getCurrentUser())) return [];
  const supabase = await createClient();
  const code = q.toUpperCase();
  const { data } = await supabase
    .from("airports")
    .select("iata, name, city, country_code")
    .or(`iata.eq.${/^[A-Z]{3}$/.test(code) ? code : "___"},city.ilike.${q}%,name.ilike.%${q}%`)
    .order("iata")
    .limit(20);
  const rows = data ?? [];
  // Exact code first, then city matches, then name matches.
  const score = (a: AirportOption) =>
    a.iata === code ? 0 : a.city?.toLowerCase().startsWith(q.toLowerCase()) ? 1 : 2;
  return rows.sort((a, b) => score(a) - score(b)).slice(0, 8);
}
