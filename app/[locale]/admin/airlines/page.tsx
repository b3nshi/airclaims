import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import { daysAgoIso } from "@/lib/claims/dates";
import { createClient } from "@/lib/supabase/server";

const STALE_DAYS = 180;

export default async function AdminAirlines({ params, searchParams }: PageProps<"/[locale]/admin/airlines">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { q } = await searchParams;
  const query = String(q ?? "").replace(/[^\p{L}\p{N} -]/gu, "").trim().slice(0, 40);
  const [t, format, supabase] = await Promise.all([getTranslations("Admin"), getFormatter(), createClient()]);

  let airlinesQuery = supabase.from("airlines").select("id, name, iata, icao, country_code, is_active, is_eu_carrier").order("name");
  if (query) airlinesQuery = airlinesQuery.or(`name.ilike.%${query}%,iata.ilike.${query}%,icao.ilike.${query}%`);
  const [{ data: airlines }, { data: contacts }, { data: knowledge }] = await Promise.all([
    airlinesQuery.limit(200),
    supabase.from("airline_contacts").select("airline_id, verified_at"),
    supabase.from("airline_knowledge").select("airline_id, updated_at"),
  ]);
  const staleBefore = daysAgoIso(STALE_DAYS);

  return (
    <section className="space-y-4">
      <form className="max-w-sm">
        <Input name="q" defaultValue={query} placeholder={t("airlines.search")} aria-label={t("airlines.search")} />
      </form>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {["airline", "codes", "contacts", "verified", "kb"].map((c) => (
                <th key={c} className="px-3 py-2 font-medium">{t(`airlines.col.${c}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {(airlines ?? []).map((a) => {
              const own = (contacts ?? []).filter((c) => c.airline_id === a.id);
              const verified = own.map((c) => c.verified_at).filter(Boolean).sort().at(-1) ?? null;
              const kb = knowledge?.find((k) => k.airline_id === a.id);
              const stale = own.length > 0 && (!verified || verified < staleBefore);
              return (
                <tr key={a.id}>
                  <td className="px-3 py-2">
                    <Link href={`/admin/airlines/${a.id}`} className="font-medium hover:underline">{a.name}</Link>
                    {!a.is_active && <span className="ml-2 text-xs text-muted-foreground">{t("airlines.inactive")}</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{[a.iata, a.icao, a.country_code].filter(Boolean).join(" · ")}</td>
                  <td className="px-3 py-2">{own.length}</td>
                  <td className={stale ? "px-3 py-2 text-amber-700 dark:text-amber-400" : "px-3 py-2"}>
                    {verified ? format.dateTime(new Date(verified), { dateStyle: "medium" }) : own.length ? t("airlines.neverVerified") : "—"}
                  </td>
                  <td className="px-3 py-2">{kb ? "✓" : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("airlines.staleHint", { days: STALE_DAYS })}</p>
    </section>
  );
}
