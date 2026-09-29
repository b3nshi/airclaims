"use server";

import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { invalid, type FormState } from "@/lib/claims/form-state";
import { FLIGHT_NUMBER_RE, normalizeFlightNumber } from "@/lib/claims/model";
import { requestFlightCheck } from "@/lib/claims/flight-check";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { guardClaim } from "./guard";

const today = () => new Date().toISOString().slice(0, 10);
const iata = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

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
  });
  if (!parsed.success) return invalid(parsed.error.issues);
  const v = parsed.data;
  const finalIata = v.has_connection ? v.final_destination_iata : null;

  const supabase = await createClient();
  const codes = [v.dep_iata, v.arr_iata, ...(finalIata ? [finalIata] : [])];
  const [airportsRes, airlineRes, flightRes] = await Promise.all([
    supabase.from("airports").select("iata").in("iata", codes),
    supabase.from("airlines").select("id").eq("iata", v.flight_iata.slice(0, 2)).maybeSingle(),
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
      dep: LookupAirport;
      arr: LookupAirport;
      delayMinutes: number | null;
      cancelled: boolean;
    }
  | { status: "checking_no_data" | "not_found" | "unavailable" | "rate_limited" | "invalid" };

async function airportLabels(codes: (string | null)[]) {
  const wanted = codes.filter((c): c is string => !!c);
  if (!wanted.length) return () => null;
  const supabase = await createClient();
  const { data } = await supabase.from("airports").select("iata, name, city").in("iata", wanted);
  return (code: string | null): LookupAirport => {
    const a = data?.find((x) => x.iata === code);
    return code ? { iata: code, label: a ? `${a.city || a.name} (${a.iata})` : code } : null;
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
  const label = await airportLabels([f.dep_iata, f.arr_iata]);
  return {
    status: check.status === "final" || f.data_status === "final" ? "found" : "checking",
    flightId: f.id,
    dep: label(f.dep_iata),
    arr: label(f.arr_iata),
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
