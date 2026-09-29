import createIntlMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { refreshSession } from "@/lib/supabase/proxy";

const handleI18nRouting = createIntlMiddleware(routing);

export async function proxy(request: NextRequest) {
  const session = await refreshSession(request);
  const response = handleI18nRouting(request);
  session.cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  Object.entries(session.headers).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}

export const config = {
  // Skip Next internals, Vercel internals, the auth callback, API routes and static files.
  matcher: "/((?!api|auth|_next|_vercel|.*\\..*).*)",
};
