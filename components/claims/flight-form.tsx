"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { checkFlight, saveFlight, type LookupResult } from "@/app/[locale]/claims/_actions/flight";
import { initialFormState } from "@/lib/claims/form-state";
import { AirportField, type AirportValue } from "./airport-field";
import { WizardNav } from "./wizard-nav";

const POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 4000;

export type FlightFormValues = {
  flight_iata: string;
  flight_date: string;
  dep: AirportValue | null;
  arr: AirportValue | null;
  final: AirportValue | null;
  booking_reference: string;
  flight_id: string;
};

export function FlightForm({ locale, claimId, initial }: { locale: string; claimId: string | null; initial: FlightFormValues }) {
  const t = useTranslations("Flight");
  const tw = useTranslations("Wizard");
  const [state, formAction] = useActionState(saveFlight.bind(null, locale, claimId), initialFormState);
  const [flight, setFlight] = useState(initial.flight_iata);
  const [date, setDate] = useState(initial.flight_date);
  const [dep, setDep] = useState(initial.dep);
  const [arr, setArr] = useState(initial.arr);
  const [final, setFinal] = useState(initial.final);
  const [hasConnection, setHasConnection] = useState(Boolean(initial.final));
  const [flightId, setFlightId] = useState(initial.flight_id);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [looking, startLookup] = useTransition();
  const err = (k: string) => state.fieldErrors?.[k];
  const today = new Date().toISOString().slice(0, 10);

  function apply(res: LookupResult) {
    setLookup(res);
    if (res.status === "found" || res.status === "checking") {
      if (res.dep) setDep(res.dep);
      if (res.arr) setArr(res.arr);
      setFlightId(res.flightId ?? "");
    }
  }

  // New flights are confirmed by one queued API call: poll our table for ~30 s.
  function runLookup() {
    startLookup(async () => {
      let res = await checkFlight(flight, date);
      apply(res);
      for (let i = 0; i < POLL_ATTEMPTS && (res.status === "checking" || res.status === "checking_no_data"); i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        res = await checkFlight(flight, date);
        apply(res);
      }
    });
  }

  const lookupMessage = (() => {
    switch (lookup?.status) {
      case "found":
        if (lookup.cancelled) return `${t("lookupFound")} ${t("lookupFoundCancelled")}`;
        return lookup.delayMinutes !== null && lookup.delayMinutes >= 15
          ? `${t("lookupFound")} ${t("lookupFoundDelay", { hours: Math.floor(lookup.delayMinutes / 60), minutes: lookup.delayMinutes % 60 })}`
          : t("lookupFound");
      case "checking":
      case "checking_no_data":
        return t("lookupChecking");
      case "not_found":
        return t("lookupNotFound");
      case "rate_limited":
        return t("lookupRateLimited");
      case "unavailable":
        return t("lookupUnavailable");
      case "invalid":
        return t("lookupInvalid");
      default:
        return null;
    }
  })();

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="flight_id" value={flightId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="flight_iata" label={t("flightNumber")} hint={t("flightNumberHint")} error={err("flight_iata") && tw("errorInvalid")}>
          <Input
            id="flight_iata"
            name="flight_iata"
            required
            autoCapitalize="characters"
            value={flight}
            onChange={(e) => {
              setFlight(e.target.value);
              setFlightId("");
            }}
            aria-invalid={err("flight_iata") || undefined}
            aria-describedby={describedBy("flight_iata", { hint: true, error: err("flight_iata") })}
          />
        </Field>
        <Field id="flight_date" label={t("date")} error={err("flight_date") && tw("errorInvalid")}>
          <Input
            id="flight_date"
            name="flight_date"
            type="date"
            required
            max={today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setFlightId("");
            }}
            aria-invalid={err("flight_date") || undefined}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <Button type="button" variant="outline" onClick={runLookup} disabled={looking || !flight || !date}>
          {looking ? t("lookingUp") : t("lookup")}
        </Button>
        {lookupMessage && (
          <p role="status" className="text-sm text-muted-foreground">
            {lookupMessage}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="dep_iata" label={t("from")} error={err("dep_iata") && t("airportUnknown")}>
          <AirportField
            id="dep_iata"
            name="dep_iata"
            value={dep}
            onChange={setDep}
            placeholder={t("airportPlaceholder")}
            invalid={err("dep_iata")}
            describedBy={err("dep_iata") ? "dep_iata-error" : undefined}
          />
        </Field>
        <Field id="arr_iata" label={t("to")} error={err("arr_iata") && t("airportUnknown")}>
          <AirportField
            id="arr_iata"
            name="arr_iata"
            value={arr}
            onChange={setArr}
            placeholder={t("airportPlaceholder")}
            invalid={err("arr_iata")}
            describedBy={err("arr_iata") ? "arr_iata-error" : undefined}
          />
        </Field>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="has_connection"
          className="mt-0.5 size-4"
          checked={hasConnection}
          onChange={(e) => setHasConnection(e.target.checked)}
        />
        {t("hasConnection")}
      </label>
      {hasConnection && (
        <Field
          id="final_destination_iata"
          label={t("finalDestination")}
          hint={t("finalDestinationHint")}
          error={err("final_destination_iata") && t("airportUnknown")}
        >
          <AirportField
            id="final_destination_iata"
            name="final_destination_iata"
            value={final}
            onChange={setFinal}
            placeholder={t("airportPlaceholder")}
            invalid={err("final_destination_iata")}
            describedBy={describedBy("final_destination_iata", { hint: true, error: err("final_destination_iata") })}
          />
        </Field>
      )}

      <Field
        id="booking_reference"
        label={t("bookingReference")}
        optionalLabel={tw("optional")}
        hint={t("bookingReferenceHint")}
        error={err("booking_reference") && tw("errorInvalid")}
        className="sm:max-w-xs"
      >
        <Input
          id="booking_reference"
          name="booking_reference"
          autoCapitalize="characters"
          maxLength={12}
          defaultValue={initial.booking_reference}
          aria-invalid={err("booking_reference") || undefined}
          aria-describedby={describedBy("booking_reference", { hint: true, error: err("booking_reference") })}
        />
      </Field>

      <WizardNav state={state} />
    </form>
  );
}
