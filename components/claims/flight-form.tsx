"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { checkFlight, saveFlight, type LookupResult } from "@/app/[locale]/claims/_actions/flight";
import { initialFormState } from "@/lib/claims/form-state";
import { FLIGHT_NUMBER_RE, normalizeFlightNumber } from "@/lib/claims/model";
import { AirportField, type AirportValue } from "./airport-field";
import { WizardNav } from "./wizard-nav";

const POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 4000;
const LOOKUP_DEBOUNCE_MS = 700;

export type FlightFormValues = {
  flight_iata: string;
  flight_date: string;
  dep: AirportValue | null;
  arr: AirportValue | null;
  final: AirportValue | null;
  booking_reference: string;
  flight_id: string;
  airline_id: string;
  scheduled_dep_time: string; // HH:mm, local at departure
  scheduled_arr: string; // datetime-local, local at the final destination
};

type AirlineOption = { id: string; name: string; iata: string | null };
type Found = Extract<LookupResult, { status: "found" | "checking" }>;

export function FlightForm({
  locale,
  claimId,
  initial,
  airlines,
}: {
  locale: string;
  claimId: string | null;
  initial: FlightFormValues;
  airlines: AirlineOption[];
}) {
  const t = useTranslations("Flight");
  const tw = useTranslations("Wizard");
  const format = useFormatter();
  const [state, formAction] = useActionState(saveFlight.bind(null, locale, claimId), initialFormState);
  const [flight, setFlight] = useState(initial.flight_iata);
  const [date, setDate] = useState(initial.flight_date);
  const [dep, setDep] = useState(initial.dep);
  const [arr, setArr] = useState(initial.arr);
  const [final, setFinal] = useState(initial.final);
  const [hasConnection, setHasConnection] = useState(Boolean(initial.final));
  const [flightId, setFlightId] = useState(initial.flight_id);
  const [airlineId, setAirlineId] = useState(initial.airline_id);
  const [scheduledDepTime, setScheduledDepTime] = useState(initial.scheduled_dep_time);
  const [scheduledArr, setScheduledArr] = useState(initial.scheduled_arr);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [looking, startLookup] = useTransition();
  const lastKey = useRef("");
  const err = (k: string) => state.fieldErrors?.[k];
  const today = new Date().toISOString().slice(0, 10);

  function apply(res: LookupResult) {
    setLookup(res);
    if (res.status !== "found" && res.status !== "checking") return;
    // Our flight data fills in the rest; the passenger can still change anything.
    if (res.dep) setDep(res.dep);
    if (res.arr) setArr(res.arr);
    if (res.airline) setAirlineId(res.airline.id);
    if (res.scheduledDep) setScheduledDepTime(res.scheduledDep.slice(11, 16));
    if (res.scheduledArr && !hasConnection) setScheduledArr(res.scheduledArr.slice(0, 16));
    setFlightId(res.flightId ?? "");
  }

  // Look the flight up as soon as number and date are valid. New flights are confirmed by
  // one queued API call, so poll our table for a short while.
  useEffect(() => {
    const number = normalizeFlightNumber(flight);
    const key = `${number}|${date}`;
    if (!FLIGHT_NUMBER_RE.test(number) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || key === lastKey.current) return;
    const timer = setTimeout(() => {
      lastKey.current = key;
      startLookup(async () => {
        let res = await checkFlight(number, date);
        apply(res);
        for (let i = 0; i < POLL_ATTEMPTS && (res.status === "checking" || res.status === "checking_no_data"); i++) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          res = await checkFlight(number, date);
          apply(res);
        }
      });
    }, LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // apply/today are stable enough for this lookup; re-run only when the key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight, date]);

  const found = lookup && (lookup.status === "found" || lookup.status === "checking") ? (lookup as Found) : null;
  const when = (local: string | null) =>
    local ? format.dateTime(new Date(`${local.slice(0, 16)}:00Z`), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) : "—";
  const lookupMessage =
    lookup?.status === "checking" || lookup?.status === "checking_no_data"
      ? t("lookupChecking")
      : lookup?.status === "not_found"
        ? t("lookupNotFound")
        : lookup?.status === "rate_limited"
          ? t("lookupRateLimited")
          : lookup?.status === "unavailable"
            ? t("lookupUnavailable")
            : null;

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

      <div aria-live="polite">
        {looking && !found && <p className="text-sm text-muted-foreground">{t("lookingUp")}</p>}
        {found && (
          <section className="space-y-2 rounded-lg border border-primary/40 bg-muted/30 p-4 text-sm">
            <h3 className="font-medium">
              {found.status === "found" ? t("foundTitle") : t("foundProvisional")}
            </h3>
            <p>
              {[found.airline?.name, found.dep?.label && found.arr?.label ? `${found.dep.label} → ${found.arr.label}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <dl className="grid gap-1 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t("foundScheduled")}</dt>
                <dd>{when(found.scheduledDep)} → {when(found.scheduledArr)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("foundActual")}</dt>
                <dd>{when(found.actualDep)} → {when(found.actualArr)}</dd>
              </div>
            </dl>
            {found.flightStatus && <p className="text-xs text-muted-foreground">{t("foundStatus", { status: found.flightStatus })}</p>}
            <p className="text-xs text-muted-foreground">{t("foundFilled")}</p>
          </section>
        )}
        {lookupMessage && <p role="status" className="text-sm text-muted-foreground">{lookupMessage}</p>}
      </div>

      <Field id="airline_id" label={t("airline")} optionalLabel={tw("optional")} hint={t("airlineHint")}>
        <NativeSelect id="airline_id" name="airline_id" value={airlineId} onChange={(e) => setAirlineId(e.target.value)}>
          <option value="">{t("airlineAuto")}</option>
          {airlines.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.iata ? ` (${a.iata})` : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>

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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="scheduled_dep_time" label={t("scheduledDepTime")} optionalLabel={tw("optional")} hint={t("scheduledDepTimeHint")}>
          <Input
            id="scheduled_dep_time"
            name="scheduled_dep_time"
            type="time"
            value={scheduledDepTime}
            onChange={(e) => setScheduledDepTime(e.target.value)}
            aria-describedby="scheduled_dep_time-hint"
          />
        </Field>
        <Field
          id="scheduled_arr"
          label={hasConnection ? t("scheduledArrFinal") : t("scheduledArr")}
          optionalLabel={tw("optional")}
          hint={t("scheduledArrHint")}
        >
          <Input
            id="scheduled_arr"
            name="scheduled_arr"
            type="datetime-local"
            value={scheduledArr}
            onChange={(e) => setScheduledArr(e.target.value)}
            aria-describedby="scheduled_arr-hint"
          />
        </Field>
      </div>

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
