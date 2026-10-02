import type { EmailStatus } from "@/lib/supabase/database.types";

/** What happens after the airline answers, for one answer (compensation or expenses claim). */
export const ANSWER_STEPS = ["paste", "read", "choose", "send", "wait"] as const;
export type AnswerStep = (typeof ANSWER_STEPS)[number];

export type AnswerStepsInput = {
  response: "none" | "pending" | "analyzed" | "failed";
  // The reply drafted for this answer, if any. Discarded drafts ("ignored") count as none.
  reply: { status: EmailStatus; pasted: boolean } | null;
};

export type AnswerSteps = {
  current: AnswerStep;
  // What the passenger must do at the current step, when it isn't obvious from the step.
  detail?: "read_failed" | "approve" | "copy" | "sending" | "send_failed";
};

/** Pure, so it's unit-tested. */
export function answerSteps({ response, reply }: AnswerStepsInput): AnswerSteps {
  if (response === "none") return { current: "paste" };
  if (response === "pending") return { current: "read" };
  if (response === "failed") return { current: "read", detail: "read_failed" };
  if (!reply || reply.status === "ignored") return { current: "choose" };
  switch (reply.status) {
    case "draft": // a text to paste into the airline's form
      return reply.pasted ? { current: "wait" } : { current: "send", detail: "copy" };
    case "pending_approval":
      return { current: "send", detail: "approve" };
    case "approved":
    case "sending":
      return { current: "send", detail: "sending" };
    case "failed":
      return { current: "send", detail: "send_failed" };
    default: // sent (or received, which doesn't apply to replies)
      return { current: "wait" };
  }
}
