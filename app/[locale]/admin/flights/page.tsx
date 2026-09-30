import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AdminForm } from "@/components/admin/admin-form";
import { AreaField, CheckField, SelectField, TextField } from "@/components/admin/fields";
import { createClient } from "@/lib/supabase/server";
import { saveFlight } from "../_actions";

const minutes = (from: string | null, to: string | null) =>
  from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 60000) : null;

// Our flight table: what the wizard and the flight-check worker read before any API call.
export default async function AdminFlights({ params }: PageProps<"/[locale]/admin/flights">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, format, supabase] = await Promise.all([getTranslations("Admin"), getFormatter(), createClient()]);
  const { data: flights } = await supabase
    .from("flights")
    .select("id, flight_iata, flight_date, dep_iata, arr_iata, scheduled_dep, actual_dep, arrival_delay_minutes, status, candidate, data_status, source, last_checked_at")
    .or("source.eq.manual,candidate.neq.none")
    .order("flight_date", { ascending: false })
    .limit(50);
  const hm = (m: number | null) => (m === null ? "—" : `${Math.floor(m / 60)} h ${m % 60} min`);

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border p-5">
        <div>
          <h2 className="font-semibold">{t("flights.addTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("flights.addDescription")}</p>
        </div>
        <AdminForm action={saveFlight.bind(null, locale)} submitLabel={t("save")}>
          <div className="grid gap-3 sm:grid-cols-4">
            <TextField name="flight_iata" label={t("flights.number")} required />
            <TextField name="flight_date" type="date" label={t("flights.date")} hint={t("flights.dateHint")} required />
            <TextField name="dep_iata" label={t("flights.from")} required />
            <TextField name="arr_iata" label={t("flights.to")} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <TextField name="scheduled_dep" type="datetime-local" label={t("flights.scheduledDep")} />
            <TextField name="actual_dep" type="datetime-local" label={t("flights.actualDep")} />
            <TextField name="dep_offset" label={t("flights.depOffset")} defaultValue="+02:00" hint={t("flights.offsetHint")} required />
            <SelectField
              name="status"
              label={t("flights.status")}
              options={["", "Scheduled", "Delayed", "Departed", "Arrived", "Canceled", "Diverted"].map((s) => ({ value: s, label: s || "—" }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <TextField name="scheduled_arr" type="datetime-local" label={t("flights.scheduledArr")} />
            <TextField name="actual_arr" type="datetime-local" label={t("flights.actualArr")} hint={t("flights.actualArrHint")} />
            <TextField name="arr_offset" label={t("flights.arrOffset")} defaultValue="+02:00" required />
          </div>
          <AreaField name="note" rows={2} label={t("flights.note")} />
          <CheckField name="final" label={t("flights.final")} defaultChecked />
        </AdminForm>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">{t("flights.listTitle")}</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {["flight", "route", "depDelay", "arrDelay", "status", "candidate", "data", "source"].map((c) => (
                  <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">{t(`flights.col.${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {(flights ?? []).map((f) => (
                <tr key={f.id} className="tabular-nums">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="font-medium">{f.flight_iata}</span>{" "}
                    <span className="text-xs text-muted-foreground">{format.dateTime(new Date(f.flight_date), { dateStyle: "medium", timeZone: "UTC" })}</span>
                  </td>
                  <td className="px-3 py-2">{f.dep_iata}–{f.arr_iata}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{hm(minutes(f.scheduled_dep, f.actual_dep))}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{hm(f.arrival_delay_minutes)}</td>
                  <td className="px-3 py-2">{f.status ?? "—"}</td>
                  <td className="px-3 py-2">{f.candidate}</td>
                  <td className="px-3 py-2">{f.data_status}</td>
                  <td className="px-3 py-2">{f.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
