import { describe, expect, it } from "vitest";
import { nextAction, type NextActionInput } from "./next-action";

const base: NextActionInput = {
  status: "submitted_airline",
  channel: "web_form",
  hasPendingApproval: false,
  submittedAt: "2026-09-01T10:00:00Z",
  aesaDeadline: "2027-09-01",
  flightDate: "2026-08-20",
  today: "2026-09-15",
};
const next = (patch: Partial<NextActionInput>) => nextAction({ ...base, ...patch });

describe("nextAction", () => {
  it("asks to approve a pending message before anything else", () => {
    expect(next({ hasPendingApproval: true }).kind).toBe("approve_email");
    expect(next({ hasPendingApproval: true, status: "airline_replied" }).kind).toBe("approve_email");
  });
  it("asks to answer an analysed airline reply, after approvals", () => {
    expect(next({ status: "airline_replied", airlineAnswerToHandle: true })).toEqual({ kind: "respond_to_airline", aesaUntil: "2027-09-01" });
    expect(next({ status: "airline_replied", airlineAnswerToHandle: true, hasPendingApproval: true }).kind).toBe("approve_email");
    expect(next({ status: "won", airlineAnswerToHandle: true }).kind).toBe("check_payment");
  });
  it("never asks to approve on closed claims", () => {
    expect(next({ hasPendingApproval: true, status: "withdrawn" }).kind).toBe("none");
  });
  it("routes signed claims by the airline's channel", () => {
    expect(next({ status: "ready_to_submit", channel: "web_form" }).kind).toBe("submit_web_form");
    expect(next({ status: "documents_pending", channel: "email" }).kind).toBe("preparing_email");
    expect(next({ status: "ready_to_submit", channel: null }).kind).toBe("no_channel");
  });
  it("waits one month for the airline, then points to AESA", () => {
    expect(next({})).toEqual({ kind: "wait_airline", due: "2026-10-01" });
    expect(next({ today: "2026-10-01" }).kind).toBe("wait_airline");
    expect(next({ today: "2026-10-02" })).toEqual({ kind: "airline_overdue", due: "2026-10-01", aesaUntil: "2027-09-01" });
  });
  it("only mentions AESA for flights it covers (from 2 June 2023)", () => {
    expect(next({ status: "airline_replied", flightDate: "2023-06-01" }).aesaUntil).toBeUndefined();
    expect(next({ status: "airline_replied" }).aesaUntil).toBe("2027-09-01");
  });
  it("covers the remaining states", () => {
    expect(next({ status: "draft" }).kind).toBe("finish_draft");
    expect(next({ status: "won" }).kind).toBe("check_payment");
    expect(next({ status: "lost" }).kind).toBe("consider_court");
    expect(next({ status: "escalated_aesa" }).kind).toBe("wait_aesa");
  });
});

import { daysBetween, todayInMadrid } from "./dates";

describe("dates", () => {
  it("counts days between ISO dates", () => {
    expect(daysBetween("2026-09-29", "2026-10-01")).toBe(2);
    expect(daysBetween("2026-10-02", "2026-10-01")).toBe(-1);
    expect(daysBetween("2026-09-29", "2026-09-29T23:00:00Z")).toBe(0);
  });
  it("uses Madrid's calendar day", () => {
    expect(todayInMadrid(new Date("2026-09-29T22:30:00Z"))).toBe("2026-09-30");
  });
});
