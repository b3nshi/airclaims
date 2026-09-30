import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AdminForm } from "@/components/admin/admin-form";
import { TextField } from "@/components/admin/fields";
import { buttonVariants } from "@/components/ui/button";
import { requireRole } from "@/lib/admin/server";
import { aliasEmail } from "@/lib/claims/model";
import { emailBodyText } from "@/lib/emails/text";
import { createClient } from "@/lib/supabase/server";
import { linkEmailToClaim, resolveReview } from "../_actions";

// Personal data: admins only (RLS: review_queue, emails, claims).
export default async function AdminReview({ params, searchParams }: PageProps<"/[locale]/admin/review">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, "/admin/review", "admin");
  const { show } = await searchParams;
  const showDone = show === "done";
  const [t, format, supabase] = await Promise.all([getTranslations("Admin"), getFormatter(), createClient()]);

  const { data: items, error } = await supabase
    .from("review_queue")
    .select("*")
    .eq("status", showDone ? "done" : "open")
    .order("created_at", { ascending: !showDone })
    .limit(100);
  if (error) throw error;
  const emailIds = (items ?? []).map((i) => i.email_id).filter((x): x is string => !!x);
  const claimIds = (items ?? []).map((i) => i.claim_id).filter((x): x is string => !!x);
  const [{ data: emails }, { data: claims }] = await Promise.all([
    emailIds.length
      ? supabase.from("emails").select("id, from_address, to_addresses, subject, body_text, body_html, received_at, ai_summary, claim_id").in("id", emailIds)
      : Promise.resolve({ data: [] }),
    claimIds.length
      ? supabase.from("claims").select("id, flight_iata, flight_date, alias_code, status").in("id", claimIds)
      : Promise.resolve({ data: [] }),
  ]);
  const when = (d: string) => format.dateTime(new Date(d), { dateStyle: "medium", timeStyle: "short" });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t("review.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("review.description")}</p>
        </div>
        <Link href={showDone ? "/admin/review" : { pathname: "/admin/review", query: { show: "done" } }} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {showDone ? t("review.showOpen") : t("review.showDone")}
        </Link>
      </div>
      {(items ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t("review.empty")}</p>}
      <ul className="space-y-3">
        {(items ?? []).map((item) => {
          const email = emails?.find((e) => e.id === item.email_id);
          const claim = claims?.find((c) => c.id === item.claim_id);
          return (
            <li key={item.id} className="space-y-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">{t(`review.kinds.${item.kind}`)}</span>
                <span>{when(item.created_at)}</span>
              </div>
              {item.note && <p className="text-sm">{t("review.note")}: {item.note}</p>}
              {claim && (
                <p className="text-sm">
                  {t("review.claim")}: {claim.flight_iata} · {claim.flight_date} · <code>{aliasEmail(claim.alias_code)}</code> · {claim.status}
                </p>
              )}
              {email && (
                <div className="space-y-1 text-sm">
                  <p><span className="text-muted-foreground">{t("review.from")}:</span> {email.from_address}</p>
                  <p><span className="text-muted-foreground">{t("review.to")}:</span> {email.to_addresses.join(", ")}</p>
                  <p className="font-medium">{email.subject || "—"}</p>
                  {email.ai_summary && <p className="text-muted-foreground">{email.ai_summary}</p>}
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">{t("review.body")}</summary>
                    {/* Third-party content: plain text only, never rendered as HTML. */}
                    <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted/40 p-3 font-sans whitespace-pre-wrap">
                      {emailBodyText(email.body_text, email.body_html)}
                    </pre>
                  </details>
                </div>
              )}
              {item.status === "open" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {item.kind === "unmatched_email" && email && !email.claim_id && (
                    <AdminForm action={linkEmailToClaim.bind(null, locale, email.id)} submitLabel={t("review.link")} variant="outline">
                      <TextField name="alias" idSuffix={`-${item.id}`} label={t("review.alias")} hint={t("review.aliasHint")} required />
                    </AdminForm>
                  )}
                  <AdminForm action={resolveReview.bind(null, locale, item.id)} submitLabel={t("review.resolve")}>
                    <TextField name="note" idSuffix={`-${item.id}`} label={t("review.resolveNote")} />
                  </AdminForm>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
