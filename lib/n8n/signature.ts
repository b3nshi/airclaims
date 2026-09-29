import { createHmac, timingSafeEqual } from "node:crypto";

// Wire format shared with every airclaim-* workflow:
//   X-AirClaims-Timestamp: unix seconds
//   X-AirClaims-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function sign(secret: string, timestamp: string, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verify(secret: string, timestamp: string, rawBody: string, signature: string, nowSeconds: number) {
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(sign(secret, timestamp, rawBody));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
