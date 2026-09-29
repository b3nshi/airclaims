import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeleteButton } from "@/components/claims/delete-button";
import { DocumentUploader } from "@/components/claims/document-uploader";
import { StepHeader } from "@/components/claims/wizard-shell";
import { deleteDocument } from "@/app/[locale]/claims/_actions/details";
import { recheckDocuments } from "@/app/[locale]/claims/_actions/submit";
import { isDraft } from "@/lib/claims/model";
import { loadStep } from "@/lib/claims/server";
import { createClient } from "@/lib/supabase/server";

const SLOTS = ["boarding_pass", "booking_confirmation", "other"] as const;

export default async function DocumentsStep({ params }: PageProps<"/[locale]/claims/[id]/documents">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { user, claim } = await loadStep(locale, id, "documents");
  const [t, tw, format] = await Promise.all([getTranslations("Documents"), getTranslations("Wizard"), getFormatter()]);
  const supabase = await createClient();
  const { data: documents } = await supabase
    .from("documents")
    .select("id, doc_type, mime_type, created_at")
    .eq("claim_id", claim.id)
    .neq("doc_type", "receipt")
    .order("created_at");
  const draft = isDraft(claim.status);

  return (
    <Card>
      <CardContent className="space-y-6 py-2">
        <StepHeader title={t("title")} description={t("description")} />
        {SLOTS.map((slot) => {
          const docs = documents?.filter((d) => d.doc_type === slot) ?? [];
          return (
            <section key={slot} className="space-y-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{t(`types.${slot}`)}</h3>
                <DocumentUploader locale={locale} claimId={claim.id} userId={user.id} docType={slot} />
              </div>
              {docs.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {docs.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        {t("uploadedOn", { date: format.dateTime(new Date(d.created_at), { dateStyle: "medium", timeStyle: "short" }) })}
                        {d.mime_type === "application/pdf" ? " · PDF" : ""}
                      </span>
                      <form action={deleteDocument.bind(null, locale, claim.id, d.id)}>
                        <DeleteButton label={t("remove")} />
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{t("missingHint")}</p>
          <p>{t("idNotice")}</p>
        </div>
        <div className="flex items-center justify-between gap-3 border-t pt-5">
          <Link href={draft ? `/claims/${claim.id}/expenses` : `/claims/${claim.id}`} className={buttonVariants({ variant: "ghost" })}>
            {tw("back")}
          </Link>
          {draft ? (
            <Link href={`/claims/${claim.id}/review`} className={buttonVariants({ size: "lg" })}>
              {tw("continue")}
            </Link>
          ) : (
            <form action={recheckDocuments.bind(null, locale, claim.id)}>
              <Button type="submit" size="lg">{t("recheck")}</Button>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
