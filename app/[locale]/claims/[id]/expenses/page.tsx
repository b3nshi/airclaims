import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeleteButton } from "@/components/claims/delete-button";
import { ExpenseForm } from "@/components/claims/expense-form";
import { StepHeader } from "@/components/claims/wizard-shell";
import { deleteExpense } from "@/app/[locale]/claims/_actions/details";
import { isDraft } from "@/lib/claims/model";
import { loadStep } from "@/lib/claims/server";
import { createClient } from "@/lib/supabase/server";

export default async function ExpensesStep({ params }: PageProps<"/[locale]/claims/[id]/expenses">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { user, claim } = await loadStep(locale, id, "expenses");
  const [t, tw, format] = await Promise.all([getTranslations("Expenses"), getTranslations("Wizard"), getFormatter()]);
  const supabase = await createClient();
  const { data: expenses } = await supabase.from("claim_expenses").select("*").eq("claim_id", claim.id).order("spent_at");
  const draft = isDraft(claim.status);

  return (
    <Card>
      <CardContent className="space-y-6 py-2">
        <StepHeader title={t("title")} description={t("description")} />
        {expenses?.length ? (
          <ul className="divide-y rounded-lg border">
            {expenses.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {t(`categories.${e.category}`)} · {format.number(e.amount, { style: "currency", currency: e.currency })}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[e.description, e.document_id ? t("receiptAttached") : t("noReceipt"), e.airline_promised && t("promisedBadge")]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <form action={deleteExpense.bind(null, locale, claim.id, e.id)}>
                  <DeleteButton label={t("remove")} />
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        )}
        <ExpenseForm locale={locale} claimId={claim.id} userId={user.id} />
        <div className="flex items-center justify-between gap-3 border-t pt-5">
          <Link href={draft ? `/claims/${claim.id}/passengers` : `/claims/${claim.id}/done`} className={buttonVariants({ variant: "ghost" })}>
            {tw("back")}
          </Link>
          <Link href={`/claims/${claim.id}/${draft ? "documents" : "done"}`} className={buttonVariants({ size: "lg" })}>
            {tw("continue")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
