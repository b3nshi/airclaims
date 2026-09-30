import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

const num = (v: number | null | undefined) => (v === null || v === undefined ? "—" : String(v));

// Our own outcomes per airline (admin_airline_stats). No personal data.
export default async function AdminStats({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, format, supabase] = await Promise.all([getTranslations("Admin"), getFormatter(), createClient()]);
  const { data, error } = await supabase.rpc("admin_airline_stats");
  if (error) throw error;
  const rows = data ?? [];
  const withActivity = rows.filter((r) => r.claims_total > 0 || r.knowledge_updated_at || r.contacts_last_verified);
  const date = (d: string | null) => (d ? format.dateTime(new Date(d), { dateStyle: "medium" }) : "—");

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{t("stats.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("stats.description")}</p>
      </div>
      {withActivity.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("stats.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {["airline", "claims", "open", "outcome", "success", "firstReply", "overdue", "resolution", "offers", "kb", "verified"].map((c) => (
                  <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">{t(`stats.col.${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {withActivity.map((r) => (
                <tr key={r.airline_id} className="tabular-nums">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/admin/airlines/${r.airline_id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">{r.iata}</span>
                  </td>
                  <td className="px-3 py-2">{r.claims_total}</td>
                  <td className="px-3 py-2">{r.claims_open}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.won} / {r.partially_won} / {r.lost}</td>
                  <td className="px-3 py-2">{r.success_rate_pct === null ? "—" : `${r.success_rate_pct}%`}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {num(r.median_days_first_reply)} <span className="text-xs text-muted-foreground">({t("stats.avg")} {num(r.avg_days_first_reply)}, n={r.replies})</span>
                  </td>
                  <td className={r.overdue_replies ? "px-3 py-2 text-destructive" : "px-3 py-2"}>{r.overdue_replies}</td>
                  <td className="px-3 py-2">{num(r.avg_days_to_resolution)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.offers_total} <span className="text-xs text-muted-foreground">({t("stats.offerSplit", { credit: r.offers_credit, partial: r.offers_money_partial, full: r.offers_money_full })})</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{date(r.knowledge_updated_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{date(r.contacts_last_verified)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("stats.legend")}</p>
    </section>
  );
}
