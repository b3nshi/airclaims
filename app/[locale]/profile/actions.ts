"use server";

import { hasLocale } from "next-intl";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export type ProfileState = {
  status: "idle" | "saved" | "invalid" | "error";
  fieldErrors?: Partial<Record<"full_name" | "personal_email" | "preferred_locale", true>>;
};

// Only the columns users may edit (enforced again by the column grant in migration 0002).
const profileSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  personal_email: z.email().max(254),
  preferred_locale: z.string().refine((l) => hasLocale(routing.locales, l)),
});

export async function updateProfile(locale: string, _prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const user = await getCurrentUser();
  if (!user) redirect({ href: "/login", locale });

  const parsed = profileSchema.safeParse({
    full_name: formData.get("full_name"),
    personal_email: String(formData.get("personal_email") ?? "").trim().toLowerCase(),
    preferred_locale: formData.get("preferred_locale"),
  });
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], true]));
    return { status: "invalid", fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", user!.id);
  if (error) return { status: "error" };

  if (parsed.data.preferred_locale !== locale) {
    redirect({ href: "/profile", locale: parsed.data.preferred_locale });
  }
  revalidatePath(`/${locale}/profile`);
  return { status: "saved" };
}
