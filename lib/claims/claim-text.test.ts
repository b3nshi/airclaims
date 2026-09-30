import { describe, expect, it } from "vitest";
import { buildClaimText, type ClaimTextInput } from "./claim-text";

const input: ClaimTextInput = {
  airlineLanguage: "en",
  airlineName: "Wizz Air",
  flight: "W62345",
  flightDate: "2026-09-01",
  departure: "Barcelona (BCN)",
  arrival: "Budapest (BUD)",
  finalDestination: "Budapest (BUD)",
  bookingReference: "ABC123",
  disruption: "delay",
  arrivalDelayMinutes: 245,
  cancellationNoticeDays: null,
  perPassengerEur: 400,
  totalEur: 800,
  passengers: ["Laura Martí", "Joan Martí"],
  expenses: [{ category: "meal", amount: 18.5, currency: "EUR" }],
  staffInstructions: "Take a taxi and claim it",
  aliasEmail: "airclaims_abc234@airclaims.klivr.com",
  departsSpain: true,
};

describe("buildClaimText", () => {
  it("includes the facts, amount, passengers and signature", () => {
    const { subject, body } = buildClaimText(input);
    expect(subject).toContain("W62345");
    expect(body).toContain("4 hours and 5 minutes late");
    expect(body).toContain("€800");
    expect(body).toContain("- Joan Martí");
    expect(body).toContain("Take a taxi and claim it");
    expect(body).toContain("Spanish Aviation Safety Agency (AESA)");
    expect(body.trim().endsWith("Laura Martí")).toBe(true);
  });
  it("always asks for money and refuses vouchers", () => {
    for (const lang of ["en", "es", "hu"]) {
      const { body } = buildClaimText({ ...input, airlineLanguage: lang });
      expect(body).toMatch(/bank transfer|transferencia bancaria/);
      expect(body).toMatch(/vouchers|bonos/);
    }
  });
  it("never presents itself as a law firm", () => {
    for (const lang of ["en", "es"]) {
      expect(buildClaimText({ ...input, airlineLanguage: lang }).body).not.toMatch(/law firm|lawyer|abogad/i);
    }
  });
  it("says approximately when the arrival time is estimated", () => {
    expect(buildClaimText({ ...input, arrivalDelayEstimated: true }).body).toContain("approximately 4 hours and 5 minutes late");
    expect(buildClaimText({ ...input, airlineLanguage: "es", arrivalDelayEstimated: true }).body).toContain("aproximadamente 4 horas");
  });
  it("splits compensation and expenses for airlines that need separate submissions", () => {
    const comp = buildClaimText({ ...input, purpose: "compensation" });
    expect(comp.body).toContain("€800");
    expect(comp.body).not.toContain("Meals");
    const exp = buildClaimText({ ...input, purpose: "expenses" });
    expect(exp.subject).toContain("Reimbursement of expenses");
    expect(exp.body).toContain("- Meals: €18.50");
    expect(exp.body).toContain("Articles 8 and 9");
    expect(exp.body).not.toContain("€800");
    expect(exp.body).toMatch(/bank transfer/);
  });
  it("writes Spanish for Spanish-language airlines", () => {
    const { body } = buildClaimText({ ...input, airlineLanguage: "es", disruption: "cancellation", cancellationNoticeDays: 3 });
    expect(body).toContain("se me informó 3 días antes");
  });
  it("omits figures when the amount is unknown", () => {
    const { body } = buildClaimText({ ...input, perPassengerEur: null, totalEur: null });
    expect(body).toContain("compensation set out in Article 7");
  });
});
