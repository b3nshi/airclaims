import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sign, verify } from "./signature";

describe("n8n webhook signature", () => {
  const body = JSON.stringify({ flight_iata: "W62345", flight_date: "2026-09-01" });

  it("is HMAC-SHA256 over `${timestamp}.${body}`", () => {
    const expected = createHmac("sha256", "s3cret").update(`1700000000.${body}`).digest("hex");
    expect(sign("s3cret", "1700000000", body)).toBe(`sha256=${expected}`);
  });
  it("verifies fresh, untampered requests", () => {
    const sig = sign("s3cret", "1700000000", body);
    expect(verify("s3cret", "1700000000", body, sig, 1700000100)).toBe(true);
  });
  it("rejects tampered bodies, wrong secrets and stale timestamps", () => {
    const sig = sign("s3cret", "1700000000", body);
    expect(verify("s3cret", "1700000000", body + " ", sig, 1700000000)).toBe(false);
    expect(verify("other", "1700000000", body, sig, 1700000000)).toBe(false);
    expect(verify("s3cret", "1700000000", body, sig, 1700000301)).toBe(false);
  });
});
