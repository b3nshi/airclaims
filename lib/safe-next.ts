import { routing } from "@/i18n/routing";

const PATH_RE = new RegExp(`^/(${routing.locales.join("|")})(/[A-Za-z0-9_-]+)*$`);

/** A same-origin, locale-prefixed path to return to after login, or null. No open redirects. */
export function safeNextPath(next: unknown): { path: string; locale: string } | null {
  if (typeof next !== "string" || !PATH_RE.test(next)) return null;
  return { path: next, locale: next.split("/")[1] };
}
