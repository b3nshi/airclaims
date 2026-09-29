# n8n workflows (`https://labs.klivr.com`)

Importable exports of every `airclaim-*` workflow. Import via *Workflows → Import from file*,
set the credentials below, then activate.

## Shared setup (once per n8n instance)

Environment variables on the n8n server:

| Variable | Purpose |
|---|---|
| `AIRCLAIMS_WEBHOOK_SECRET` | Same value as the app's `N8N_WEBHOOK_SECRET` (HMAC key) |
| `AIRCLAIMS_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `AIRCLAIMS_SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS — n8n only) |
| `NODE_FUNCTION_ALLOW_BUILTIN=crypto` | Code nodes verify signatures with `crypto` |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` | Lets nodes read the variables above |

Secrets that live only in n8n credentials: Anthropic API key, AeroDataBox (RapidAPI) key,
Aviationstack key, Forward Email SMTP.

### Signature contract (app → n8n)

Every request from the app carries:

- `X-AirClaims-Timestamp`: unix seconds; rejected when more than 300 s off.
- `X-AirClaims-Signature`: `sha256=` + hex HMAC-SHA256(secret, `` `${timestamp}.${rawBody}` ``).
- `X-AirClaims-Idempotency-Key`: a UUID; workflows with side effects must drop repeats.

The Webhook node must have **Raw Body** enabled so the signature is checked against the exact
bytes sent. Reference implementation: `lib/n8n/signature.ts`.

---

## `airclaim-flight-check`

Confirms flights with **one AeroDataBox call per flight**, once it has landed. Our `flights`
table is the source of truth; the app never calls the API directly.

How a check flows (logic lives in SQL, migration `0005`, so it's testable and the same for
every caller):

1. The app calls `request_flight_check(flight, date)` (step 1 lookup, and on every saved
   claim). Final data in `flights` → answered immediately, no API call. Otherwise the flight
   is queued once in `flight_checks` (unique per flight + date, so concurrent users share it).
2. If that request created the check and it's already due, the app pokes this workflow
   (signed webhook, `{ "reason": "new_check" }`). The **10-minute schedule** catches
   everything else, including missed pokes.
3. `claim_due_flight_checks(5)` leases due checks (`FOR UPDATE SKIP LOCKED` + 10 min lease), so
   two runs never call the API for the same flight.
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

Credentials: create a **Header Auth** credential named `AeroDataBox (RapidAPI key)` with header
`X-RapidAPI-Key`, and select it in the *AeroDataBox* node.

Notes:
- `actual_arr` is the API's revised/runway time, not doors-open: the passenger confirms their
  arrival delay in the wizard; our data is shown next to it on the review step.
- Airports missing from `airports` are stored as `null` instead of failing the upsert.
- **Not yet run against a live n8n/AeroDataBox.** Test with a known past flight first:
  insert a check by calling `request_flight_check` as a user, then run the workflow manually.

## Planned

- `airclaim-email-draft`, `airclaim-email-send` (M4)
- `airclaim-email-inbound` (M5)
- `airclaim-finder` (M6): primarily fed by AeroDataBox's free **airport webhook subscription**
  (BCN) for delay notifications, with the FIDS poll as a reconciliation fallback. It writes to
  the same `flights` table (provisional while in the air, final once landed), so most user
  checks for BCN flights won't need an API call at all.
- `airclaim-weather` (M6), `airclaim-document-validation` (M7)
