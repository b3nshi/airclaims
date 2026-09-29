import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import locales from "@/i18n/locales.json";
import { renderLegalSource } from "./render";

const KINDS = ["terms_of_service", "privacy_notice", "email_authorization"];
const VARS = {
  CONTROLLER_NAME: "X", CONTROLLER_NIF: "X", CONTROLLER_ADDRESS: "X", CONTACT_EMAIL: "X",
  SIGNER_NAME: "Laura", ALIAS_EMAIL: "a@b", FLIGHT: "W62345", FLIGHT_DATE: "2026-09-01",
  AIRLINE: "Wizz Air", FEE_BASE: "15", FEE_MIN: "10",
};
const read = (locale: string, kind: string) =>
  readFileSync(path.join(process.cwd(), "content/legal", locale, `${kind}.md`), "utf8");

describe("legal texts", () => {
  it.each(locales.locales.flatMap((l) => KINDS.map((k) => [l, k])))("%s/%s renders with no leftover variables", (l, k) => {
    const doc = renderLegalSource(read(l, k), VARS);
    expect(doc.text).not.toMatch(/\{\{/);
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.text).not.toContain("LEGAL REVIEW"); // marker stays in the source, not the signed text
  });
  it.each(KINDS)("%s has the same version in every locale", (k) => {
    const versions = new Set(locales.locales.map((l) => renderLegalSource(read(l, k), VARS).version));
    expect(versions.size).toBe(1);
  });
  it("hash changes when a variable changes", () => {
    const a = renderLegalSource(read("en", "email_authorization"), VARS);
    const b = renderLegalSource(read("en", "email_authorization"), { ...VARS, SIGNER_NAME: "Other" });
    expect(a.sha256).not.toBe(b.sha256);
  });
});
