import "server-only";
import { randomUUID } from "node:crypto";
import { sign } from "./signature";

export class N8nNotConfiguredError extends Error {}

/**
 * Calls an n8n webhook (`airclaim-*`) with an HMAC-signed JSON body.
 * The idempotency key lets workflows drop retries of the same request.
 */
export async function callN8n<T>(
  workflow: `airclaim-${string}`,
  payload: unknown,
  { idempotencyKey = randomUUID(), timeoutMs = 15_000 }: { idempotencyKey?: string; timeoutMs?: number } = {},
): Promise<T> {
  const base = process.env.N8N_WEBHOOK_BASE_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!base || !secret) throw new N8nNotConfiguredError();

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const res = await fetch(`${base.replace(/\/$/, "")}/${workflow}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AirClaims-Timestamp": timestamp,
      "X-AirClaims-Signature": sign(secret, timestamp, body),
      "X-AirClaims-Idempotency-Key": idempotencyKey,
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`n8n ${workflow} responded ${res.status}`);
  return (await res.json()) as T;
}
