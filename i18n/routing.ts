import { defineRouting } from "next-intl/routing";
import config from "./locales.json";

// Locales live in locales.json + messages/{locale}.json: adding one needs no code change.
export const routing = defineRouting({
  locales: config.locales,
  defaultLocale: config.defaultLocale,
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
