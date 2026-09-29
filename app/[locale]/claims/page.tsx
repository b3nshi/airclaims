import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/dashboard/sections";
import { isDraft } from "@/lib/claims/model";
import { requireUser } from "@/lib/claims/server";
import { createClient } from "@/lib/supabase/server";

export default async function ClaimsPage({ params }: PageProps<"/[locale]/claims">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser(locale, "/claims");
  const [t, format, supabase] = await Promise.all([getTranslations("Claims"), getFormatter(), createClient()]);
  const { data: claims, error } = await supabase
    .from("claims")
    .select("id, flight_iata, flight_date, dep_iata, arr_iata, status")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const { data: pending } = await supabase.from("my_emails").select("claim_id").eq("status", "pending_approval");
  const awaitingUser = new Set((pending ?? []).map((e) => e.claim_id));
  // Statuses where the next step is the user's (see lib/claims/next-action.ts).
  const needsAction = (c: (typeof claims)[number]) =>
    awaitingUser.has(c.id) || ["draft", "documents_pending", "ready_to_submit", "airline_replied"].includes(c.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <Link href="/claims/new" className={buttonVariants()}>
          {t("new")}
        </Link>
      </div>
      {claims.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {claims.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {c.flight_iata} · {format.dateTime(new Date(c.flight_date), { dateStyle: "medium", timeZone: "UTC" })}
                  {needsAction(c) && <Badge tone="action">{t("actionNeeded")}</Badge>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {[c.dep_iata, c.arr_iata].filter(Boolean).join(" → ")} · {t(`status.${c.status}`)}
                </p>
              </div>
              <Link
                href={isDraft(c.status) ? `/claims/${c.id}/flight` : `/claims/${c.id}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t("open")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
