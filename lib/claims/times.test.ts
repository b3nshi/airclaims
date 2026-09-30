import { describe, expect, it } from "vitest";
import { estimateArrival, instantToLocal, localToInstant, minutesLate } from "./times";

describe("airport local times", () => {
  it("converts local times with DST-aware offsets", () => {
    expect(localToInstant("2026-09-19T21:45", "Europe/Madrid").toISOString()).toBe("2026-09-19T19:45:00.000Z");
    expect(localToInstant("2026-01-15T21:45", "Europe/Madrid").toISOString()).toBe("2026-01-15T20:45:00.000Z");
    expect(localToInstant("2026-09-19T12:00", "Atlantic/Canary").toISOString()).toBe("2026-09-19T11:00:00.000Z");
    expect(localToInstant("2026-09-19T12:00", null).toISOString()).toBe("2026-09-19T12:00:00.000Z");
  });
  it("round-trips to local time", () => {
    expect(instantToLocal("2026-09-19T21:40:00Z", "Europe/Rome")).toBe("2026-09-19T23:40");
    expect(instantToLocal("2026-10-25T01:30:00Z", "Europe/Madrid")).toBe("2026-10-25T02:30");
  });
  it("counts the arrival delay across midnight (W4 6020, BCN→FCO)", () => {
    expect(minutesLate("2026-09-19T23:40", "2026-09-20T13:05", "Europe/Rome")).toBe(805);
  });
  it("handles the night clocks go back", () => {
    // Madrid, 25 Oct 2026: 03:00 CEST becomes 02:00 CET, so 01:30 → 04:30 local is 4 hours.
    expect(minutesLate("2026-10-25T01:30", "2026-10-25T04:30", "Europe/Madrid")).toBe(240);
  });
  it("estimates arrival from departure + scheduled duration, across time zones", () => {
    // BCN 21:45 → FCO 23:40 is a 1h55 flight; leaving BCN at 11:00 lands ~12:55 in Rome.
    expect(estimateArrival({ scheduledDep: "2026-09-19T21:45", scheduledArr: "2026-09-19T23:40", actualDep: "2026-09-20T11:00",
      depTz: "Europe/Madrid", arrTz: "Europe/Rome" })).toBe("2026-09-20T12:55");
    // BCN 10:00 → LHR 11:15 local is 2h15 (London is an hour behind).
    expect(estimateArrival({ scheduledDep: "2026-09-19T10:00", scheduledArr: "2026-09-19T11:15", actualDep: "2026-09-19T14:00",
      depTz: "Europe/Madrid", arrTz: "Europe/London" })).toBe("2026-09-19T15:15");
  });
});
