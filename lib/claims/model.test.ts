import { describe, expect, it } from "vitest";
import { decodeReason, encodeReason, FLIGHT_NUMBER_RE, nextStep, normalizeFlightNumber } from "./model";

describe("claim model helpers", () => {
  it("normalizes flight numbers", () => {
    expect(normalizeFlightNumber(" w6 2345 ")).toBe("W62345");
    expect(FLIGHT_NUMBER_RE.test("W62345")).toBe(true);
    expect(FLIGHT_NUMBER_RE.test("VY1234A")).toBe(true);
    expect(FLIGHT_NUMBER_RE.test("W6")).toBe(false);
  });
  it("round-trips the airline's reason", () => {
    expect(decodeReason(encodeReason("technical", "engine: left"))).toEqual({ category: "technical", details: "engine: left" });
    expect(decodeReason("weather")).toEqual({ category: "weather", details: "" });
    expect(decodeReason("free text")).toEqual({ category: "other", details: "free text" });
  });
  it("moves through the wizard", () => {
    expect(nextStep("flight")).toBe("disruption");
    expect(nextStep("done")).toBe("done");
  });
});
