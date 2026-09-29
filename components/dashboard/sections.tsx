import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { daysBetween } from "@/lib/claims/dates";
import { emailBodyText } from "@/lib/emails/text";
import type {
  ClaimEventRow,
  ClaimExpenseRow,
  ClaimStatus,
  DocumentRow,
  MyEmailRow,
} from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { EmailDraft } from "./email-draft";

export function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Badge({ tone = "muted", children }: { tone?: "muted" | "action" | "ok" | "warn"; children: React.ReactNode }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    action: "bg-primary text-primary-foreground",
    ok: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
    warn: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  };
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export async function Deadlines({ today, items }: { today: string; items: { label: string; date: string }[] }) {
  const [t, format] = await Promise.all([getTranslations("Dashboard"), getFormatter()]);
  if (!items.length) return null;
  return (
    <Section title={t("deadlinesTitle")}>
      <dl className="grid gap-3 sm:grid-cols-3">
        {items.map(({ label, date }) => {
          const days = daysBetween(today, date);
          return (
            <div key={label} className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-medium">{format.dateTime(new Date(date), { dateStyle: "long", timeZone: "UTC" })}</dd>
              <dd className={cn("text-xs", days < 0 ? "text-destructive" : days <= 14 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                {days < 0 ? t("passed") : days === 0 ? t("today") : t("daysLeft", { days })}
              </dd>
            </div>
          );
        })}
      </dl>
    </Section>
  );
}

export async function Messages({
  locale,
  claimId,
  alias,
  emails,
}: {
  locale: string;
  claimId: string;
  alias: string;
  emails: MyEmailRow[];
}) {
  const [t, format] = await Promise.all([getTranslations("Dashboard"), getFormatter()]);
  // Discarded drafts stay in the database (and the timeline), not in the conversation.
  const visible = emails.filter((e) => !(e.direction === "outbound" && e.status === "ignored"));
  const sorted = [...visible].sort((a, b) =>
    a.status === "pending_approval" && b.status !== "pending_approval"
      ? -1
      : b.status === "pending_approval" && a.status !== "pending_approval"
        ? 1
        : b.created_at.localeCompare(a.created_at),
  );
  return (
    <Section id="messages" title={t("messagesTitle")}>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noMessages")}</p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((e) => {
            const pending = e.status === "pending_approval";
            const who =
              e.direction === "inbound"
                ? t("from", { from: e.from_address ?? "—" })
                : t("to", { to: e.status === "sent" ? (e.to_addresses?.join(", ") ?? "") : (e.recipient_label ?? "—") });
            const when = e.sent_at ?? e.received_at ?? e.created_at;
            const body = emailBodyText(e.body_text, e.body_html);
            return (
              <li key={e.id} className={cn("space-y-2 rounded-lg border p-4", pending && "border-primary")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{e.subject || "—"}</p>
                  <Badge tone={pending ? "action" : e.status === "failed" ? "warn" : "muted"}>{t(`emailStatus.${e.status}`)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {who} · {format.dateTime(new Date(when), { dateStyle: "medium", timeStyle: "short" })}
                </p>
                {e.ai_summary && <p className="text-sm">{t("summary", { summary: e.ai_summary })}</p>}
                {pending ? (
                  <EmailDraft
                    key={`${e.id}:${e.subject}:${body.length}`}
                    locale={locale}
                    claimId={claimId}
                    email={{ id: e.id, subject: e.subject ?? "", body, recipient: e.recipient_label ?? "—" }}
                    alias={alias}
                  />
                ) : (
                  body && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground">{t("showMessage")}</summary>
                      <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted/40 p-3 font-sans whitespace-pre-wrap">{body}</pre>
                    </details>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export async function Documents({
  claimId,
  documents,
  canAdd,
}: {
  claimId: string;
  documents: Pick<DocumentRow, "id" | "doc_type" | "validation" | "created_at">[];
  canAdd: boolean;
}) {
  const [t, td, format] = await Promise.all([getTranslations("Dashboard"), getTranslations("Documents"), getFormatter()]);
  return (
    <Section title={t("documentsTitle")}>
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noDocuments")}</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <p className="font-medium">{td(`types.${d.doc_type}`)}</p>
                <p className="text-xs text-muted-foreground">
                  {format.dateTime(new Date(d.created_at), { dateStyle: "medium" })} · {t(`validation.${d.validation}`)}
                </p>
              </div>
              {/* Short-lived signed URL, generated per click. */}
              <a href={`/api/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("view")}
              </a>
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <Link href={`/claims/${claimId}/documents`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {t("manageDocuments")}
        </Link>
      )}
    </Section>
  );
}

export async function Expenses({
  claimId,
  expenses,
  totalEur,
  canEdit,
}: {
  claimId: string;
  expenses: ClaimExpenseRow[];
  totalEur: number;
  canEdit: boolean;
}) {
  const [t, te, format] = await Promise.all([getTranslations("Dashboard"), getTranslations("Expenses"), getFormatter()]);
  return (
    <Section title={t("expensesTitle")}>
      {expenses.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noExpenses")}</p>
      ) : (
        <>
          <ul className="divide-y rounded-lg border text-sm">
            {expenses.map((e) => (
              <li key={e.id} className="flex justify-between gap-3 p-3">
                <span>
                  {te(`categories.${e.category}`)}
                  {e.description ? ` · ${e.description}` : ""}
                </span>
                <span className="tabular-nums">{format.number(Number(e.amount), { style: "currency", currency: e.currency })}</span>
              </li>
            ))}
          </ul>
          {totalEur > 0 && (
            <p className="text-sm text-muted-foreground">
              {t("total", { amount: format.number(totalEur, { style: "currency", currency: "EUR" }) })}
            </p>
          )}
        </>
      )}
      {canEdit && (
        <Link href={`/claims/${claimId}/expenses`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {t("manageExpenses")}
        </Link>
      )}
    </Section>
  );
}

export async function Timeline({ createdAt, events }: { createdAt: string; events: ClaimEventRow[] }) {
  const [t, tc, format] = await Promise.all([getTranslations("Dashboard"), getTranslations("Claims"), getFormatter()]);
  const known = [
    "status_changed", "email_approved", "submitted_airline", "email_received", "email_sent", "document_validated",
    "email_drafted", "email_failed", "email_draft_failed", "email_edited", "email_discarded",
  ];
  const label = (e: ClaimEventRow) => {
    if (e.event_type === "status_changed") {
      const to = (e.payload as { to?: ClaimStatus } | null)?.to;
      return to ? t("event.status_changed", { status: tc(`status.${to}`) }) : t("event.other");
    }
    return known.includes(e.event_type) ? t(`event.${e.event_type}`) : t("event.other");
  };
  const rows = [{ key: "created", text: t("event.created"), at: createdAt }].concat(
    events.map((e) => ({ key: String(e.id), text: label(e), at: e.created_at })),
  );
  return (
    <Section title={t("timelineTitle")}>
      <ol className="space-y-3 border-l pl-4 text-sm">
        {rows.reverse().map((r) => (
          <li key={r.key} className="relative">
            <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-primary" aria-hidden />
            <p>{r.text}</p>
            <p className="text-xs text-muted-foreground">{format.dateTime(new Date(r.at), { dateStyle: "medium", timeStyle: "short" })}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
