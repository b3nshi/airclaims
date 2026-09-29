import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";

type PendingCookie = { name: string; value: string; options: Record<string, unknown> };

/**
 * Refreshes the Supabase session if needed. Updated cookies are written to the
 * request (so this render sees them) and returned so the caller can set them
 * on whatever response it builds.
 */
export async function refreshSession(request: NextRequest) {
  const pending: { cookies: PendingCookie[]; headers: Record<string, string> } = {
    cookies: [],
    headers: {},
  };
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        pending.cookies = cookiesToSet;
        pending.headers = headers ?? {};
      },
    },
  });
  // Do not remove: validates the JWT and triggers a refresh when it has expired.
  await supabase.auth.getClaims();
  return pending;
}
