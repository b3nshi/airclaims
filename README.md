# AirClaims

Assisted EU261 self-claims — `airclaims.klivr.com`. Product and engineering rules: [CLAUDE.md](CLAUDE.md).

## Local development

```bash
pnpm install
cp .env.example .env.local   # fill in the Supabase URL + anon key
pnpm dev
```

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm build`.

## Supabase (EU project)

1. Link and apply migrations:
   ```bash
   supabase login
   supabase link --project-ref <ref>
   supabase db push
   pnpm db:types   # regenerate lib/supabase/database.types.ts
   ```
2. **Auth → URL Configuration**
   - Site URL: `https://airclaims.klivr.com`
   - Redirect URLs: `https://airclaims.klivr.com/auth/confirm`, `http://localhost:3000/auth/confirm`
     (plus your Vercel preview domain pattern if you test previews).
3. **Auth → Email Templates → Magic Link**: point the link at our confirm route so it
   works even when opened on another device:
   ```html
   <a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Sign in</a>
   ```
   (`RedirectTo` already contains `/auth/confirm?next=/{locale}/profile`.) Do the same for
   the **Confirm signup** template, since a first sign-in creates the account.
4. **Auth → SMTP**: use Forward Email (e.g. `no-reply@airclaims.klivr.com`). The built-in
   sender is limited to a few emails per hour.

## Deploy (Vercel)

- Functions run in `fra1` (`vercel.json`). Keep it close to the Supabase region.
- Set the variables from `.env.example` for Production (and Preview if used).
  `SUPABASE_SERVICE_ROLE_KEY` and `N8N_WEBHOOK_SECRET` must never get a `NEXT_PUBLIC_` prefix.

## i18n

Locales are listed in `i18n/locales.json` with strings in `messages/{locale}.json`.
Adding a locale = add both (plus legal texts under `content/legal/{locale}/` from M2); no code changes.
