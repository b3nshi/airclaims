import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AirlineSubmission, airlineChannel } from "@/components/claims/airline-submission";
import { CopyButton } from "@/components/claims/copy-button";
import { ExpensesSubmission } from "@/components/claims/expenses-submission";
import { ForwardingGuide } from "@/components/claims/forwarding-guide";
import { StepHeader } from "@/components/claims/wizard-shell";
import { assessClaim } from "@/lib/claims/assess";
import { aliasEmail } from "@/lib/claims/model";
import { loadStep } from "@/lib/claims/server";
import { createClient } from "@/lib/supabase/server";

// Shown right after signing. Once the claim has been sent, the dashboard takes over.
export default async function DoneStep({ params }: PageProps<"/[locale]/claims/[id]/done">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { user, claim } = await loadStep(locale, id, "done");
  const [t, supabase] = await Promise.all([getTranslations("Done"), createClient()]);
  const [a, channel, { data: profile }] = await Promise.all([
    assessClaim(claim),
    airlineChannel(claim.airline_id),
    supabase.from("profiles").select("personal_email").eq("id", user.id).maybeSingle(),
  ]);
  const alias = aliasEmail(claim.alias_code);
  const toSend = claim.status === "ready_to_submit" || claim.status === "documents_pending";

  return (
    <Card>
      <CardContent className="space-y-8 py-2">
        <StepHeader title={t("title")} />

        <section className="space-y-2">
          <h3 className="font-medium">{t("aliasTitle")}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-muted px-2 py-1 text-sm break-all">{alias}</code>
            <CopyButton value={alias} />
          </div>
          <p className="text-sm text-muted-foreground">{t("aliasBody", { email: profile?.personal_email ?? "" })}</p>
        </section>

        {claim.status === "documents_pending" && (
          <section className="space-y-2 rounded-lg border border-amber-500/50 p-4">
            <h3 className="font-medium">{t("docsPendingTitle")}</h3>
            <p className="text-sm text-muted-foreground">{t("docsPendingBody")}</p>
            <Link href={`/claims/${claim.id}/documents`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("addDocuments")}
            </Link>
          </section>
        )}

        {toSend && (
          <section className="space-y-4">
            <h3 className="font-medium">{t("nextTitle")}</h3>
            <AirlineSubmission locale={locale} claim={claim} assessment={a} channel={channel} />
            <ExpensesSubmission locale={locale} claim={claim} assessment={a} />
            {channel !== "email" && <ForwardingGuide claim={claim} open />}
          </section>
        )}

        <div className="border-t pt-5">
          <Link href={`/claims/${claim.id}`} className={buttonVariants({ variant: "outline" })}>
            {t("toDashboard")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
