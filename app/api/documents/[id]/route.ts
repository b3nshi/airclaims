import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

const SIGNED_URL_SECONDS = 60;

/**
 * Opens one of the user's documents through a short-lived signed URL. RLS decides
 * whether the document is theirs; the private bucket is never exposed directly.
 */
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/documents/[id]">) {
  const { id } = await params;
  const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await getCurrentUser())) {
    return new NextResponse(null, { status: 404, headers: noStore });
  }

  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("storage_path").eq("id", id).maybeSingle();
  if (!doc) return new NextResponse(null, { status: 404, headers: noStore });

  const { data, error } = await supabase.storage.from("claim-documents").createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS);
  if (error || !data) return new NextResponse(null, { status: 404, headers: noStore });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: noStore });
}
