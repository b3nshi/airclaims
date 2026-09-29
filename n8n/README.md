# n8n workflows (`https://labs.klivr.com`)

Importable exports of every `airclaim-*` workflow. Import via *Workflows → Import from file*,
set the credentials below, then activate.

## Setup (free self-hosted n8n: no environment variables needed)

Workflows are **built** from `n8n/src` (Code-node JavaScript, the drafting prompt) by
`python3 scripts/build-n8n-workflows.py`. Edit the sources, rebuild, re-import.

### 1. Credentials (secrets, encrypted, instance-wide)

Create these once in *Credentials*; every workflow refers to them by name:

| Name | Type | Value |
|---|---|---|
| `AirClaims Supabase (service role)` | Custom Auth | `{"headers": {"apikey": "<service role key>", "Authorization": "Bearer <service role key>"}}` |
| `AeroDataBox (RapidAPI key)` | Header Auth | header `X-RapidAPI-Key` |
| `Anthropic API key` | Header Auth | header `x-api-key` |
| `Forward Email API` | Basic Auth | user = Forward Email API token, password empty |
| `Forward Email inbound webhook (basic auth)` | Basic Auth | any long random user + password; the same pair goes in the webhook URL (see `airclaim-email-inbound`) |

### 2. `airclaim-config` (settings, instance-wide)

Import `airclaim-config.json` first and edit its **Settings** node: `supabase_url`, `app_url`,
`notify_from`, `forwardemail_api_url`, `anthropic_model`, `anthropic_effort`, batch sizes. It holds
no secrets. Every other workflow starts with a **Load config** node (Execute Workflow) that calls
it: after importing each workflow, open *Load config* once and pick `airclaim-config` in the list.
Change a setting in one place and every workflow picks it up.

### 3. Webhook secret (Supabase Vault, not n8n)

The HMAC secret shared with the app (`N8N_WEBHOOK_SECRET`) lives only in Supabase Vault. Incoming
webhooks are verified by the `verify_webhook_signature` RPC (migration `0009`), so n8n never
holds it. Run once in the Supabase SQL editor:

```sql
select vault.create_secret('<same value as N8N_WEBHOOK_SECRET>', 'airclaims_webhook_secret');
select vault.create_secret('https://labs.klivr.com/webhook', 'airclaims_n8n_base_url');  -- approval trigger
```

Nothing else is required on the n8n host: no `NODE_FUNCTION_ALLOW_*`, no `$env`.

### Signature contract (app → n8n)

Every request from the app carries:

- `X-AirClaims-Timestamp`: unix seconds; rejected when more than 300 s off.
- `X-AirClaims-Signature`: `sha256=` + hex HMAC-SHA256(secret, `` `${timestamp}.${rawBody}` ``).
- `X-AirClaims-Idempotency-Key`: a UUID; workflows with side effects must drop repeats.

The Webhook node has **Raw Body** enabled so the signature is checked against the exact bytes
sent. Reference implementations: `lib/n8n/signature.ts` (app) and `verify_webhook_signature` (SQL).

---

## `airclaim-flight-check`

Confirms flights with **one AeroDataBox call per flight**, once it has landed. Our `flights`
table is the source of truth; the app never calls the API directly.

How a check flows (logic lives in SQL, migrations `0005` and `0007`, so it's testable and the
same for every caller). **The API is only called for a flight we have no final data for.**

Triggers: (a) a signed poke from the app, sent only when a user's check *created* a new queue
entry that is already due; (b) a schedule every 10 minutes that picks up retries and missed
pokes.

1. The app calls `request_flight_check(flight, date)` (step 1 lookup, and on every saved
   claim). Final data in `flights` → answered immediately, no API call. Otherwise the flight
   is queued once in `flight_checks` (unique per flight + date, so concurrent users share it).
2. If that request created the check and it's already due, the app pokes this workflow
   (signed webhook, `{ "reason": "new_check" }`). The **10-minute schedule** catches
   everything else, including missed pokes.
3. `claim_due_flight_checks(5)` is **cache first**: it closes queued checks whose flight is
   already final in `flights` (e.g. filled by another check or the airport feed) without any API
   call, then leases only flights we still don't know (`FOR UPDATE SKIP LOCKED` + 10 min lease,
   so two runs never call the API for the same flight). When nothing is due it returns nothing
   and the *Has check?* guard stops the run: the 10-minute schedule is a database query, not an
   API call.
4. One AeroDataBox call per leased check (1 request/1.1 s), then:
   - found → `complete_flight_check`: upserts `flights` (`data_status = final` when
     Arrived/Cancelled/Diverted), sets `candidate`, logs the raw record to `flight_observations`,
     links waiting claims.
   - no data (204/404) → `complete_flight_check(found = false)`: one retry after 24 h (provider
     lag), then `not_found` for good.
   - 429/5xx/timeout → `fail_flight_check`: back-off retry, `failed` after 5 attempts.

When the call happens: flights are first called at **noon (Madrid) the day after departure**,
when practically everything has landed; if the API still says "not landed", one more call after
the scheduled arrival + 3 h. Past flights (most claims) are called right away. Tunables:
`flight_check_config()` in `0005`.

Users get at most 20 new checks per day (checks of already-known flights are free).

Notes:
- `actual_arr` is the API's revised/runway time, not doors-open: the passenger confirms their
  arrival delay in the wizard; our data is shown next to it on the review step.
- Airports missing from `airports` are stored as `null` instead of failing the upsert.
- **Not yet run against a live n8n/AeroDataBox.** Test with a known past flight first:
  insert a check by calling `request_flight_check` as a user, then run the workflow manually.

## `airclaim-email-draft`

AI-drafted claim and follow-up emails. Nothing is sent from here: drafts land as
`pending_approval` and the user approves them in the dashboard.

- **In:** signed `POST /webhook/airclaim-email-draft`
  `{ "claim_id", "template": "initial_claim" | "follow_up" | "offer_reply" }`. The app calls it after
  signing (email-channel airlines) and from the dashboard: "Prepare my claim email" (if the first
  attempt failed), "Prepare a reminder" (airline overdue), "Prepare a reply asking to be paid in
  money" (the latest airline message offered a voucher, credit, miles or less money than claimed).
- **`offer_reply`** declines the offer (Art. 7(3): money unless the passenger agrees in writing),
  accepts no conditions, restates the amount and asks for a bank transfer within 14 days. It's
  threaded onto the offer. Recipient: the curated email contact, or else the offer's sender, only
  when its domain is the airline's (website or a curated contact); otherwise it's refused.
- **Flow:** verify signature → 202 → `claim_webhook_key` (idempotency) → `email_draft_context`
  (eligibility: signed email authorization, airline has an email contact, one open draft at a
  time) → Claude → guardrails → `insert_email_draft` → notify the user.
- **What the model sees:** only the `ai` part of the context (flight, passengers, facts, amounts,
  expenses, alias). The user's personal email and the airline's address never go to the model.
- **Model call:** `anthropic_model` / `anthropic_effort` from `airclaim-config` (default
  `claude-opus-5-5`, `medium`), structured output `{subject, body}`,
  `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): if a safety classifier
  declines, the API retries on its recommended fallback model instead of failing.
- **Guardrails (Check draft):** rejects refusals, non-JSON, wrong lengths, drafts that don't
  include the alias, the lead passenger's signature or the claimed amount, and any mention of
  lawyers/law firms or of AirClaims. Rejected drafts are logged (`email_draft_failed`) and the
  idempotency key released so the user can retry.
- **Recipient:** chosen by `insert_email_draft` from curated `airline_contacts` (channel `email`),
  never by the model. Initial claims attach the boarding pass, booking and receipts.

- **Edit / discard:** before approving, the user can rewrite the draft or discard it in the
  dashboard (`update_email_draft` / `discard_email_draft`); after a discard they can request a new
  draft. Model, effort: `airclaim-config`.

## `airclaim-email-send`

Sends emails the user approved, each at most once.

- **Triggers:** a signed poke from the database when a message is approved (trigger
  `trg_email_approved`, via pg_net; empty body, HMAC over `${timestamp}.{}`), plus a sweep every
  5 minutes.
- **Flow:** `claim_approved_emails` leases approved messages (`approved → sending`, skip-locked) →
  attachment paths are signed in one Storage call (5-minute URLs, so the service key stays in the
  credential) → the **Forward Email API** (`POST /v1/emails`) sends from the claim alias as
  `"<lead passenger>" <airclaims_xxx@…>`, Reply-To the alias, `Message-ID` `<email-uuid@airclaims.klivr.com>`
  (stored; follow-ups set `In-Reply-To`/`References`) → `mark_email_sent` / `mark_email_failed` →
  notify the user (also via the API, from `notify_from`).
- **At most once:** a message stuck in `sending` for 30 min is marked `failed`, never retried
  automatically (it may have gone out). A human decides.
- **Starts the clock:** the first sent claim email moves the claim to `submitted_airline` and sets
  `submitted_airline_at` (airline reply due in 1 month; AESA deadline 1 year).

Without the Vault secrets (setup step 3) the approval trigger does nothing and the 5-minute sweep
still sends.

**Check with Forward Email before going live:** the API requires `from` to be an alias of the
domain. Confirm the catch-all covers every `airclaims_*@airclaims.klivr.com` address and that
`no-reply@` exists, with a test send; otherwise sends are rejected and marked `failed`.

## `airclaim-email-inbound`

Every email to a claim alias (`airclaims_xxxxxx@`) or `support@` reaches this workflow.

**Forward Email setup** (paid plan, *My Account → Domains → Aliases*, so the URL isn't public DNS):

- regex alias `/^airclaims_[a-z0-9]{6}$/` → `https://<user>:<password>@labs.klivr.com/webhook/airclaim-email-inbound?raw=false`
- `support` → the same URL (and `no-reply`, to catch bounces)

`?raw=false` drops the raw RFC 822 copy (the parsed message and attachments are still sent), which
keeps payloads well under n8n's 16 MB limit.

**Flow:**

1. **Authenticate** with the Basic Auth credential. Forward Email signs payloads (`X-Webhook-Signature`,
   HMAC-SHA256 over the body), but verifying that in Supabase would mean posting the whole message,
   attachments included, to the database; Basic Auth over HTTPS with a private URL is used instead.
2. **Parse** mailparser's JSON (HTML → text; attachments limited to PDF/images ≤ 10 MB, max 10).
3. **`ingest_inbound_email`** stores it once (idempotent on Message-ID, so Forward Email's retries
   are harmless) and finds the claim by alias, or by `In-Reply-To` of one of our messages.
   Only then does the webhook answer 200.
   - from the passenger themself, to `support@`, or matching no claim → **human review queue**
     (`review_queue`), never answered automatically;
   - our own senders looping back → stored as `ignored`.
4. **Attachments** → Storage (`{owner}/{claim}/…`, or `_inbound/{email}/…` when unmatched) →
   `attach_inbound_files` (claim documents of type `airline_correspondence`).
5. **Claude reads it** (`anthropic_effort_classify`, default `low`; structured output): who sent it
   (airline / AESA / court / spam / other), what it is (acknowledgement, request for information,
   offer, decision, rejection), any **settlement offer** (voucher, credit, miles, money full or
   partial, amount, conditions), **documents requested**, the airline's reference, and a summary and
   suggested action in the passenger's language. The model sees the claim context and the message,
   never the passenger's personal email; the message is treated as untrusted data.
6. **`apply_inbound_analysis`** acts only on the obvious: a substantive airline answer moves
   `submitted_airline → airline_replied`; the airline's reference is saved if we had none. Offers,
   document requests and AESA/court mail also go to the review queue. Nothing is ever accepted.
7. **Forward** to the passenger's personal email (Forward Email API, from `notify_from`, Reply-To
   `support_email`) with the summary, an explanation of any offer ("you don't have to accept; you
   can ask to be paid in money"), the documents requested, the original message and its attachments.
   Spam isn't forwarded. If the AI step fails, the message is forwarded anyway, without a summary.

The review queue has no admin UI yet: use Supabase Studio (`review_queue where status = 'open'`).

## Planned

- `airclaim-finder` (M6): primarily fed by AeroDataBox's free **airport webhook subscription**
  (BCN) for delay notifications, with the FIDS poll as a reconciliation fallback. It writes to
  the same `flights` table (provisional while in the air, final once landed), so most user
  checks for BCN flights won't need an API call at all.
- `airclaim-weather` (M6), `airclaim-document-validation` (M7)
