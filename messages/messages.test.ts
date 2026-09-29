import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "@/i18n/locales.json";

type Tree = { [key: string]: string | Tree };
const keys = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : keys(v, `${prefix}${k}.`)));
const load = (locale: string): Tree => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));

describe("messages", () => {
  const reference = keys(load(config.defaultLocale)).sort();
  it.each(config.locales)("%s has exactly the default locale's keys", (locale) => {
    expect(keys(load(locale)).sort()).toEqual(reference);
  });
});
