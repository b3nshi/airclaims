import { describe, expect, it } from "vitest";
import { answerSteps } from "./answer-steps";

describe("answerSteps", () => {
  it("follows the answer from pasting to waiting", () => {
    expect(answerSteps({ response: "none", reply: null })).toEqual({ current: "paste" });
    expect(answerSteps({ response: "pending", reply: null })).toEqual({ current: "read" });
    expect(answerSteps({ response: "failed", reply: null })).toEqual({ current: "read", detail: "read_failed" });
    expect(answerSteps({ response: "analyzed", reply: null })).toEqual({ current: "choose" });
  });

  it("emailed replies wait for approval, then for the airline", () => {
    expect(answerSteps({ response: "analyzed", reply: { status: "pending_approval", pasted: false } })).toEqual({ current: "send", detail: "approve" });
    expect(answerSteps({ response: "analyzed", reply: { status: "sending", pasted: false } }).detail).toBe("sending");
    expect(answerSteps({ response: "analyzed", reply: { status: "failed", pasted: false } }).detail).toBe("send_failed");
    expect(answerSteps({ response: "analyzed", reply: { status: "sent", pasted: false } })).toEqual({ current: "wait" });
  });

  it("texts for the airline's form wait until the passenger says they pasted it", () => {
    expect(answerSteps({ response: "analyzed", reply: { status: "draft", pasted: false } })).toEqual({ current: "send", detail: "copy" });
    expect(answerSteps({ response: "analyzed", reply: { status: "draft", pasted: true } })).toEqual({ current: "wait" });
  });

  it("a discarded reply goes back to choosing", () => {
    expect(answerSteps({ response: "analyzed", reply: { status: "ignored", pasted: false } })).toEqual({ current: "choose" });
  });
});
