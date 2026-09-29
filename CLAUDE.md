# AirClaims — project brief (read this first)

AirClaims (airclaims.klivr.com) helps air passengers claim EU261 compensation themselves,
assisted by AI, for a success-only fee far below claim agencies. Barcelona (BCN) first.

## Product principles (non-negotiable)

1. **Assisted self-claim, not representation.** The passenger is always the claimant. We prepare,
   track and advise. We never hold power of attorney and never receive the compensation money.
2. **The user approves every outbound message.** Nothing is sent to an airline, AESA or anyone else
   without an explicit approval click. Before sending, the user sees the full body and a recipient
   label (e.g. "Wizz Air – Claims department"); the exact address is revealed once sent.
3. **Never accept a settlement on the user's behalf.** Vouchers, credits or reduced offers are always
   surfaced to the user with an explanation. Claim texts must request payment in money.
4. **Be honest.** Messages are sent from the passenger's alias in their name, under the email
   authorization they signed. Never claim to be a law firm or lawyers.
5. **Privacy by default (GDPR).** Collect the minimum. Ask for an ID document only when a specific
   step requires it. No personal data in URLs, logs or analytics. EU hosting for data.
6. **Multilingual from day one.** `es` (default), `en`, `ca`. All UI strings and legal texts through
   i18n; adding a locale must not require code changes.

## Legal rules the logic must encode (EU261 as applied in Spain, Sept 2026)

- Scope: flights departing an EU/IS/NO/CH airport (any airline), or arriving there from a third country
  on an EU carrier.
- Delay compensation: **arrival delay ≥ 3h** at final destination (Sturgeon case law). Arrival = doors open.
- Cancellation: compensation unless notified ≥14 days before, or 7–14 days / <7 days with rerouting
  within the Art. 5.1(c) limits.
- Amounts (great-circle distance): ≤1500 km → €250; intra-EU >1500 km or 1500–3500 km → €400; else €600.
  Per passenger with a paid ticket.
- Extraordinary circumstances (weather, ATC, security, external strikes) can excuse the airline;
  technical faults and the airline's own staff strikes generally do not. We **flag**, never auto-reject.
- Right to care expenses (meals, hotel, ground transport) are reimbursable separately, with receipts.
- Spain process: claim to airline (5-year limit; airline must reply within 1 month) → AESA binding ADR
  (within 1 year of the airline claim, flights from 2 Jun 2023) → court (juicio verbal, no lawyer < €2,000).
- A reform agreed June 2026 is expected to apply from ~2027 and may shorten claim deadlines. Keep
  thresholds, amounts and deadlines in config, not hard-coded.

## Stack

- **Web:** Next.js (App Router, TypeScript, Server Actions), Tailwind + shadcn/ui, `next-intl`.
- **Backend:** Supabase (EU region): Auth (magic link), Postgres with RLS, Storage.
  Schema: `supabase/migrations/0001_airclaims_schema.sql` (already written — use it, extend with new
  migrations, never edit applied ones).
- **Automation:** n8n at `https://labs.klivr.com`. Workflows prefixed `airclaim-`. Keep importable JSON
  exports in `/n8n`. The app talks to n8n only via webhooks signed with an HMAC shared secret; n8n
  writes to Supabase with the service role key.
- **Email:** Forward Email on `airclaims.klivr.com`. Catch-all `airclaims_*@` → n8n inbound webhook.
  Outbound via Forward Email SMTP from the claim alias. `support@airclaims.klivr.com` also → n8n.
- **Flight data:** AeroDataBox (via RapidAPI/API.Market) as primary; Aviationstack free tier as fallback
  (3 calls/day max). No scraping of airline/airport websites.
- **Weather:** METAR from aviationweather.gov.
- **AI:** Anthropic API for drafting, email classification and document extraction (called from n8n).
- **Hosting:** TBD — ask the user (Vercel EU region or their own server).

## Repo layout

```
/app/[locale]/...          pages (public, auth, dashboard)
/components                UI
/lib/eligibility           pure TS: distance, band, thresholds, scope, deadlines (+ unit tests)
/lib/supabase              server/browser clients (service role ONLY in server code)
/lib/n8n                   signed webhook client
/messages/{es,en,ca}.json  UI strings
/content/legal/{locale}/   terms, privacy, email-authorization (versioned, marked LEGAL REVIEW REQUIRED)
/supabase/migrations       SQL
/n8n                       workflow JSON exports + README per workflow
```

## Phase 1 — MVP (build in this order, stop for review after each milestone)

### M1. App foundation

- Next.js + Supabase + next-intl scaffold, locale switcher, magic-link login, profile (name, locale,
  personal email). Minimal home: value proposition + login + placeholder for airline scorecard.
- `.env.example` with every variable documented.

### M2. Claim wizard (saves as draft at every step)

1. Flight: number + date (+ optional lookup to prefill route/times).
2. What happened: disruption type, actual arrival time, reason given, care provided
   (meals/hotel/transport), **what staff told them to do** (e.g. "take an Uber home and claim it").
3. Passengers (lead + others; free tickets excluded).
4. Expenses: category, amount, receipt upload, "airline instructed/promised this" + details.
5. Documents: boarding pass + booking confirmation (ID only if later required).
6. Review: eligibility estimate from `/lib/eligibility`, compensation, fee preview
   (`compute_fee_pct`, VAT included, applied to compensation only), risk flags if any.
7. Sign: terms, privacy notice, email authorization. Store in `agreements` with version, locale,
   IP, user agent and SHA-256 of the exact rendered text.
8. Done: show the alias `airclaims_{alias_code}@airclaims.klivr.com` with copy button and the
   **next step for this airline**:
   - airline uses a web form → show `airline_contacts.submission_steps` for the user's locale +
     link + prepared claim text to paste + instruction to use the alias as contact email;
     then ask for the airline's claim reference;
   - airline accepts email → request a draft from n8n (M4) for approval.

### M3. Dashboard

- Claims list. Claim detail: status, timeline (`claim_events`), emails via the `my_emails` view,
  **Approve & send** button (RPC `approve_email`) on pending drafts, documents, expenses,
  deadlines (airline reply due = submitted + 1 month; AESA deadline), recommended next action.

### M4. n8n `airclaim-email-draft` + `airclaim-email-send`

- Draft: webhook {claim_id, template} → AI writes claim/follow-up in the airline's
  `preferred_language` from claim data → insert `emails` (outbound, `pending_approval`,
  `recipient_label`) → event.
- Send: Supabase DB webhook on `emails.status = 'approved'` → send via SMTP from alias → set
  `sent`, `message_id`, `sent_at` → event → notify user.

### M5. n8n `airclaim-email-inbound`

- Forward Email webhook → match alias → store → AI classify (user / airline / aesa / spam / other)
  - summary + detect settlement offers or document requests → forward to user's personal email
    with the summary → event; update claim status when obvious (e.g. airline replied).
- Mail from the user to their alias or support → mark for reply (human in the loop).
- Unmatched mail → store with `claim_id = null` for admin review.

### M6. n8n `airclaim-finder` + `airclaim-weather`

- Every 6h: AeroDataBox FIDS arrivals + departures for monitored airports (BCN) → upsert `flights`,
  log `flight_observations`, set `candidate` (possible > 15 min, candidate ≥ 180 min arrival delay).
- For candidates: fetch METARs around scheduled times at both airports → `weather_observations`
  → create `flight_risk_flags` for severe weather.
- Link existing claims to matching flights.

### M7. n8n `airclaim-document-validation`

- Webhook after upload → AI extracts name/flight/date/PNR (or amount/date for receipts) → compare
  with claim + flight data → `validation` passed / needs_review / failed + reasons. Never
  auto-reject; `needs_review` goes to a human.

## Later phases (do not build yet)

Phase 2: payments (Stripe, invoices issued manually in Xolo), AESA escalation pack, success stories +
message relay, airline knowledge base + public scorecard, `airclaim-strikes` (RSS → AI → disruption
events, human-confirmed), programmatic SEO flight pages and articles.
Phase 3: `airclaim-ads` (geofenced ads on 3h+ delays), `airclaim-social` (Bluesky/Mastodon),
more airports and languages.

## Engineering rules

- Service role key never reaches the browser. All user reads go through RLS.
- Every webhook verifies an HMAC signature and is idempotent.
- Storage: private bucket, path `{owner_id}/{claim_id}/{uuid}.{ext}`, short-lived signed URLs.
- Unit tests for `/lib/eligibility` (distance bands, 3h boundary, scope, cancellation notice rules).
- Small commits; ask before adding paid services or changing the schema of existing tables.
