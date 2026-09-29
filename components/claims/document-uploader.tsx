"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { registerDocument } from "@/app/[locale]/claims/_actions/details";
import { UPLOAD_MAX_BYTES, UPLOAD_MIME_TYPES } from "@/lib/claims/model";
import type { DocumentType } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Uploads straight from the browser to the private bucket (RLS allows only
 * {user_id}/...), then registers the file through a server action.
 */
export function DocumentUploader({
  locale,
  claimId,
  userId,
  docType,
  label,
  onUploaded,
}: {
  locale: string;
  claimId: string;
  userId: string;
  docType: Exclude<DocumentType, "id_document">;
  label?: string;
  onUploaded?: (documentId: string) => void;
}) {
  const t = useTranslations("Documents");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (!(UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)) return setError(t("badType"));
    if (file.size > UPLOAD_MAX_BYTES) return setError(t("tooLarge"));
    setBusy(true);
    try {
      const path = `${userId}/${claimId}/${crypto.randomUUID()}.${EXT[file.type]}`;
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("claim-documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const res = await registerDocument(locale, claimId, {
        docType,
        storagePath: path,
        mimeType: file.type,
        sha256: await sha256Hex(file),
      });
      if ("error" in res) {
        await supabase.storage.from("claim-documents").remove([path]);
        throw new Error("register failed");
      }
      onUploaded?.(res.id);
    } catch {
      setError(t("uploadError"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-1">
      <input
        ref={input}
        type="file"
        accept={UPLOAD_MIME_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? t("uploading") : (label ?? t("upload"))}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
