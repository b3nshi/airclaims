import { getTranslations } from "next-intl/server";
import { aliasEmail } from "@/lib/claims/model";
import type { ClaimRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { CopyButton } from "./copy-button";

const hostOf = (value: string | null | undefined) => {
  if (!value) return null;
  const host = value.includes("@") ? value.split("@")[1] : value.match(/^[a-z]+:\/\/([^/:]+)/i)?.[1];
  return host ? host.toLowerCase().replace(/^www\./, "") : null;
};

/**
 * For airlines that reply to the passenger's own mailbox (e.g. Wizz's form has no field for the
 * claim address): how to forward the airline's emails to the claim address, once or with a
 * filter limited to the airline's domains. Forwarded answers are read automatically.
 */
export async function ForwardingGuide({ claim, open = false }: { claim: ClaimRow; open?: boolean }) {
  const t = await getTranslations("Forwarding");
  const supabase = await createClient();
  const [{ data: airline }, { data: contacts }] = await Promise.all([
    claim.airline_id ? supabase.from("airlines").select("name, website").eq("id", claim.airline_id).maybeSingle() : Promise.resolve({ data: null }),
    claim.airline_id ? supabase.from("airline_contacts").select("value").eq("airline_id", claim.airline_id) : Promise.resolve({ data: [] }),
  ]);
  const domains = [...new Set([hostOf(airline?.website), ...(contacts ?? []).map((c) => hostOf(c.value))].filter((d): d is string => !!d))];
  const domain = domains[0] ?? t("airlineDomain");
  const alias = aliasEmail(claim.alias_code);
  const providers = ["gmail", "outlook", "icloud"] as const;

  return (
    <details open={open} className="rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">{t("title", { airline: airline?.name ?? t("theAirline") })}</summary>
      <div className="mt-3 space-y-4 text-sm">
        <p>{t("intro")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-muted px-2 py-1 break-all">{alias}</code>
          <CopyButton value={alias} />
        </div>
        <div className="space-y-1">
          <h4 className="font-medium">{t("onceTitle")}</h4>
          <p className="text-muted-foreground">{t("onceBody")}</p>
        </div>
        <div className="space-y-2">
          <h4 className="font-medium">{t("filterTitle")}</h4>
          <p className="text-muted-foreground">{t("filterBody", { domain: domains.join(", ") || domain })}</p>
          {providers.map((p) => (
            <details key={p} className="rounded-md bg-muted/30 p-3">
              <summary className="cursor-pointer">{t(`providers.${p}.name`)}</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                {(t.raw(`providers.${p}.steps`) as string[]).map((step, i) => (
                  <li key={i}>{step.replaceAll("{alias}", alias).replaceAll("{domain}", domain)}</li>
                ))}
              </ol>
            </details>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("privacy")}</p>
      </div>
    </details>
  );
}
