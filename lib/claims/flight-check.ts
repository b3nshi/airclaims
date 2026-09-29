import "server-only";
import { after } from "next/server";
import { callN8n, N8nNotConfiguredError } from "@/lib/n8n/client";
import type { FlightRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type FlightCheckStatus = "final" | "pending" | "processing" | "done" | "not_found" | "failed" | "rate_limited" | "invalid";
export type FlightCheck = { status: FlightCheckStatus; trigger: boolean; flight: FlightRow | null };

/**
 * Every flight check goes through our `flights` table (request_flight_check).
 * Unknown flights are queued once; when this request created the check, the
 * n8n worker is poked after the response so the single API call happens now.
 */
export async function requestFlightCheck(flightIata: string, flightDate: string): Promise<FlightCheck> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_flight_check", {
    p_flight_iata: flightIata,
    p_flight_date: flightDate,
  });
  if (error || !data) return { status: "failed", trigger: false, flight: null };
  const check = data as unknown as FlightCheck;
  if (check.trigger) {
    after(async () => {
      try {
        await callN8n("airclaim-flight-check", { reason: "new_check" }, { timeoutMs: 5_000 });
      } catch (e) {
        // The worker's schedule picks the check up anyway.
        if (!(e instanceof N8nNotConfiguredError)) console.error("airclaim-flight-check poke failed");
      }
    });
  }
  return check;
}
