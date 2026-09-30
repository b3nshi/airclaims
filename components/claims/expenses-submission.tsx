import { getFormatter, getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import type { ClaimAssessment } from "@/lib/claims/assess";
import type { ClaimRow } from "@/lib/supabase/database.types";
import { claimTextFor, webFormContact } from "./airline-submission";
import { CopyButton } from "./copy-button";
import { ExpensesReferenceForm } from "./expenses-reference-form";

/**
 * Airlines that take expenses as a separate claim (e.g. Wizz): steps, an expenses-only text,
 * the receipts to upload and a field for that claim's own reference. Renders nothing when
 * the airline has no separate expenses form or the passenger has no expenses.
 */
export async function ExpensesSubmission({
  locale,
  claim,
  assessment: a,
}: {
  locale: string;
  claim: ClaimRow;
  assessment: ClaimAssessment;
}) {
  if (!a.expenses.length) return null;
  const contact = await webFormContact(a.airline?.id ?? null, "expenses");
  if (!contact) return null;
  const [t, te, format] = await Promise.all([getTranslations("Done"), getTranslations("Expenses"), getFormatter()]);
  const airline = a.airline?.name ?? claim.flight_iata.slice(0, 2);
  const stepsByLocale = (contact.submission_steps ?? {}) as Record<string, string[]>;
  const steps = stepsByLocale[locale] ?? stepsByLocale.en ?? [];
  const text = claimTextFor(claim, a, "expenses");

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <h3 className="font-medium">{t("expensesTitle", { airline })}</h3>
        <p className="text-sm text-muted-foreground">{t("expensesIntro", { airline })}</p>
      </div>
      <a href={contact.value} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
        {t("openExpensesForm", { airline })}
      </a>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <div className="space-y-2">
        <h4 className="text-sm font-medium">{t("receiptsToUpload")}</h4>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {a.expenses.map((e) => (
            <li key={e.id}>
              {te(`categories.${e.category}`)} · {format.number(Number(e.amount), { style: "currency", currency: e.currency })}
              {e.spent_at ? ` · ${format.dateTime(new Date(e.spent_at), { dateStyle: "medium" })}` : ""}
              {e.document_id ? "" : ` · ${te("noReceipt")}`}
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium">{t("expensesText")}</h4>
          <CopyButton value={text.body} />
        </div>
        <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/30 p-4 text-sm whitespace-pre-wrap">{text.body}</pre>
      </div>
      <ExpensesReferenceForm locale={locale} claimId={claim.id} />
    </section>
  );
}

/** Whether the passenger already recorded the separate expenses submission. */
export function expensesSubmitted(events: { event_type: string }[]) {
  return events.some((e) => e.event_type === "expenses_submitted");
}
