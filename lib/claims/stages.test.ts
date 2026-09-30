import { describe, expect, it } from "vitest";
import { claimPath, type ClaimPathInput } from "./stages";

const base: ClaimPathInput = { status: "draft", submittedAt: null, hadAirlineAnswer: false, aesaFiled: false, today: "2026-10-01" };
const path = (over: Partial<ClaimPathInput>) => claimPath({ ...base, ...over });

describe("claimPath", () => {
  it("starts in prepare, with everything else to do", () => {
    const p = path({});
    expect(p.current).toBe("prepare");
    expect(Object.values(p.states)).toEqual(["current", "todo", "todo", "todo", "todo", "todo", "todo"]);
  });

  it("signed but not sent is the send stage", () => {
    expect(path({ status: "ready_to_submit" }).current).toBe("send");
    expect(path({ status: "documents_pending" }).current).toBe("send");
  });

  it("waits for the airline for one month, then moves to AESA skipping the reply", () => {
    const waiting = path({ status: "submitted_airline", submittedAt: "2026-09-20T10:00:00Z", today: "2026-10-20" });
    expect(waiting.current).toBe("airline_wait");
    expect(waiting.due).toBe("2026-10-20");
    const overdue = path({ status: "submitted_airline", submittedAt: "2026-09-20T10:00:00Z", today: "2026-10-21" });
    expect(overdue.current).toBe("aesa_file");
    expect(overdue.states.airline_reply).toBe("skipped");
    expect(overdue.states.airline_wait).toBe("done");
  });

  it("an airline answer (even from its form) is the reply stage", () => {
    expect(path({ status: "submitted_airline", submittedAt: "2026-09-20", hadAirlineAnswer: true }).current).toBe("airline_reply");
    expect(path({ status: "airline_replied", hadAirlineAnswer: true }).current).toBe("airline_reply");
  });

  it("filed with AESA waits for the decision; court is flagged", () => {
    const p = path({ status: "escalated_aesa", submittedAt: "2026-09-20", hadAirlineAnswer: true });
    expect(p.current).toBe("aesa_wait");
    expect(p.states.aesa_file).toBe("done");
    expect(path({ status: "escalated_court" }).inCourt).toBe(true);
  });

  it("paid after the reply skips the AESA stages", () => {
    const p = path({ status: "won", submittedAt: "2026-09-20", hadAirlineAnswer: true });
    expect(p.current).toBe("closed");
    expect(p.outcome).toBe("won");
    expect(p.states.airline_reply).toBe("done");
    expect(p.states.aesa_file).toBe("skipped");
    expect(p.states.aesa_wait).toBe("skipped");
  });

  it("closed after AESA keeps the AESA stages done", () => {
    const p = path({ status: "lost", submittedAt: "2026-09-20", hadAirlineAnswer: false, aesaFiled: true });
    expect(p.outcome).toBe("lost");
    expect(p.states.aesa_wait).toBe("done");
    expect(p.states.airline_reply).toBe("skipped");
  });

  it("withdrawn before sending skips everything after preparing", () => {
    const p = path({ status: "withdrawn" });
    expect(p.states.prepare).toBe("done");
    expect(p.states.send).toBe("skipped");
    expect(p.outcome).toBe("withdrawn");
  });
});
