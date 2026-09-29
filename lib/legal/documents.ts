import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import controller from "@/content/legal/controller.json";
import { renderLegalSource, type RenderedLegal } from "./render";

export const SIGNED_AGREEMENTS = ["terms_of_service", "privacy_notice", "email_authorization"] as const;
export type SignedAgreement = (typeof SIGNED_AGREEMENTS)[number];

export async function renderLegal(
  kind: SignedAgreement,
  locale: string,
  vars: Record<string, string>,
): Promise<RenderedLegal> {
  const lang = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const file = path.join(process.cwd(), "content", "legal", lang, `${kind}.md`);
  return renderLegalSource(await readFile(file, "utf8"), { ...controller, ...vars });
}
