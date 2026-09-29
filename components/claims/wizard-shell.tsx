import { getTranslations } from "next-intl/server";
import { WizardSteps } from "./wizard-steps";

export async function WizardShell({
  title,
  claimId,
  editable,
  children,
}: {
  title: string;
  claimId: string | null;
  editable: boolean;
  children: React.ReactNode;
}) {
  const t = await getTranslations("Wizard");
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <WizardSteps claimId={claimId} editable={editable} />
        {editable && <p className="text-xs text-muted-foreground">{t("draftSaved")}</p>}
      </div>
      {children}
    </div>
  );
}

export function StepHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6 space-y-1">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
