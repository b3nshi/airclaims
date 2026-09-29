import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AirlineSubmission, airlineChannel } from "@/components/claims/airline-submission";
import { CopyButton } from "@/components/claims/copy-button";
import { Badge, Deadlines, Documents, Expenses, Messages, Timeline } from "@/components/dashboard/sections";
import { WithdrawClaim } from "@/components/dashboard/withdraw-claim";
import { aesaAvailable, airlineReplyDue, claimLimitDate } from "@/lib/eligibility";
import { assessClaim } from "@/lib/claims/assess";
import { todayInMadrid } from "@/lib/claims/dates";
import { aliasEmail, canEditDocuments, isDraft } from "@/lib/claims/model";
import { nextAction } from "@/lib/claims/next-action";
import { getOwnClaim, requireUser } from "@/lib/claims/server";
import { createClient } from "@/lib/supabase/server";

const CLOSED = ["won", "partially_won", "lost", "withdrawn"];

export default async function ClaimDashboard({ params }: PageProps<"/[locale]/claims/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireUser(locale, `/claims/${id}`);
  const claim = await getOwnClaim(id);
  if (isDraft(claim.status)) return redirect({ href: `/claims/${id}/flight`, locale });

  const supabase = await createClient();
  const [t, tc, format, a, channel, emailsRes, eventsRes, docsRes] = await Promise.all([
    getTranslations("Dashboard"),
    getTranslations("Claims"),
    getFormatter(),
    assessClaim(claim),
    airlineChannel(claim.airline_id),
    supabase.from("my_emails").select("*").eq("claim_id", claim.id),
    supabase.from("claim_events").select("*").eq("claim_id", claim.id).order("created_at"),
    supabase.from("documents").select("id, doc_type, validation, created_at").eq("claim_id", claim.id).order("created_at"),
  ]);
  for (const r of [emailsRes, eventsRes, docsRes]) if (r.error) throw r.error;
  const emails = emailsRes.data ?? [];

  const today = todayInMadrid();
  const alias = aliasEmail(claim.alias_code);
  const airline = a.airline?.name ?? claim.flight_iata.slice(0, 2);
  const action = nextAction({
    status: claim.status,
    channel,
    hasPendingApproval: emails.some((e) => e.status === "pending_approval"),
    submittedAt: claim.submitted_airline_at,
    aesaDeadline: claim.aesa_deadline,
    flightDate: claim.flight_date,
    today,
  });
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long", timeZone: "UTC" });

  const deadlines = claim.submitted_airline_at
    ? [
        { label: t("deadline.airlineReply"), date: airlineReplyDue(claim.submitted_airline_at) },
        ...(claim.aesa_deadline && aesaAvailable(claim.flight_date) ? [{ label: t("deadline.aesa"), date: claim.aesa_deadline }] : []),
      ]
    : CLOSED.includes(claim.status)
      ? []
      : [{ label: t("deadline.claimLimit"), date: claimLimitDate(claim.flight_date) }];

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="space-y-3">
        <Link href="/claims" className="text-sm text-muted-foreground hover:underline">
          ← {t("back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {claim.flight_iata} · {format.dateTime(new Date(claim.flight_date), { dateStyle: "medium", timeZone: "UTC" })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {[a.labels.departure, a.labels.finalDestination].join(" → ")} · {airline}
            </p>
          </div>
          <Badge tone={CLOSED.includes(claim.status) ? "muted" : "ok"}>{tc(`status.${claim.status}`)}</Badge>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {claim.compensation_eur !== null && (
            <div>
              <dt className="text-xs text-muted-foreground">{t("estimated")}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {format.number(Number(claim.compensation_eur), { style: "currency", currency: "EUR" })}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-muted-foreground">{t("claimEmail")}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <code className="break-all">{alias}</code>
              <CopyButton value={alias} />
            </dd>
          </div>
        </dl>
      </div>

      <Card className={action.kind === "none" ? "" : "ring-primary/40"}>
        <CardContent className="space-y-4 py-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("nextTitle")}</p>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t(`next.${action.kind}.title`, { airline })}</h2>
            <p className="text-sm">{t(`next.${action.kind}.body`, { due: action.due ? date(action.due) : "" })}</p>
            {action.aesaUntil && <p className="text-sm text-muted-foreground">{t("aesaUntil", { date: date(action.aesaUntil) })}</p>}
          </div>
          {(action.kind === "approve_email" || action.kind === "read_reply") && (
            <a href="#messages" className={buttonVariants()}>{t("goToMessages")}</a>
          )}
          {(action.kind === "submit_web_form" || action.kind === "no_channel") && (
            <AirlineSubmission locale={locale} claim={claim} assessment={a} channel={channel} />
          )}
        </CardContent>
      </Card>

      <Deadlines today={today} items={deadlines} />
      <Messages locale={locale} claimId={claim.id} alias={alias} emails={emails} />
      <Documents claimId={claim.id} documents={docsRes.data ?? []} canAdd={canEditDocuments(claim.status)} />
      <Expenses claimId={claim.id} expenses={a.expenses} totalEur={Number(claim.expenses_total_eur)} canEdit={canEditDocuments(claim.status)} />
      <Timeline createdAt={claim.created_at} events={eventsRes.data ?? []} />

      {!CLOSED.includes(claim.status) && (
        <div className="border-t pt-6">
          <WithdrawClaim locale={locale} claimId={claim.id} />
        </div>
      )}
    </div>
  );
}
