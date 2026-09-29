-- =====================================================================
-- 0002 — privilege hardening (no table structure changes)
-- =====================================================================

-- Profiles: users may only edit their own display/contact fields.
-- referral_code / referred_by drive the fee discount and are system-managed.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, preferred_locale, personal_email, marketing_consent)
  on public.profiles to authenticated;

-- claim_aliases runs with owner privileges and has no row filter; Supabase's
-- default grants would expose every alias + owner_id to the anon key.
-- Only n8n (service role) needs it.
revoke all on public.claim_aliases from anon, authenticated;
