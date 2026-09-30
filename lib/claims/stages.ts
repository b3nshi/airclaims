import { airlineReplyDue } from "@/lib/eligibility";
import type { ClaimStatus } from "@/lib/supabase/database.types";

/** The claim's lifecycle as the passenger sees it (the "path" above every claim page). */
export const CLAIM_STAGES = [
  "prepare", // the wizard: flight → … → sign
  "send", // submit to the airline (web form, or approve the email)
  "airline_wait", // the airline has one month to answer
  "airline_reply", // the airline answered: reply, challenge, decline an offer
  "aesa_file", // no answer in a month, or still disagreeing: file with AESA
  "aesa_wait", // AESA decides (or, rarely, a court)
  "closed",
] as const;
export type ClaimStage = (typeof CLAIM_STAGES)[number];

export type StageState = "done" | "current" | "todo" | "skipped";
export type ClaimOutcome = "won" | "partially_won" | "lost" | "withdrawn";

export type ClaimPathInput = {
  status: ClaimStatus;
  submittedAt: string | null;
  hadAirlineAnswer: boolean; // any airline answer reported, forwarded or received
  aesaFiled: boolean; // an aesa_filed event exists (the claim went through AESA)
  today: string; // YYYY-MM-DD
};

export type ClaimPath = {
  current: ClaimStage;
  states: Record<ClaimStage, StageState>;
  outcome?: ClaimOutcome;
  inCourt?: boolean;
  due?: string; // airline_wait: the airline must answer by this date
};

const CLOSED: ClaimStatus[] = ["won", "partially_won", "lost", "withdrawn"];

function currentStage(i: ClaimPathInput): ClaimStage {
  switch (i.status) {
    case "draft":
      return "prepare";
    case "documents_pending":
    case "validating":
    case "ready_to_submit":
      return "send";
    case "submitted_airline":
      if (i.hadAirlineAnswer) return "airline_reply";
      return i.submittedAt && i.today > airlineReplyDue(i.submittedAt) ? "aesa_file" : "airline_wait";
    case "airline_replied":
      return "airline_reply";
    case "escalated_aesa":
    case "escalated_court":
      return "aesa_wait";
    default:
      return "closed";
  }
}

/** Pure, so it's unit-tested. Stages the claim went past without using are "skipped". */
export function claimPath(i: ClaimPathInput): ClaimPath {
  const current = currentStage(i);
  const index = CLAIM_STAGES.indexOf(current);
  const closed = CLOSED.includes(i.status);
  const reachedAesa = i.aesaFiled || i.status === "escalated_aesa" || i.status === "escalated_court";

  const states = Object.fromEntries(
    CLAIM_STAGES.map((stage, n) => {
      let state: StageState = n < index ? "done" : n === index ? "current" : "todo";
      if (state === "done") {
        // No answer from the airline: the month ran out and the claim moved on without a reply.
        if (stage === "airline_reply" && !i.hadAirlineAnswer) state = "skipped";
        // Closed without AESA (paid after the claim or the reply, or withdrawn).
        if ((stage === "aesa_file" || stage === "aesa_wait") && closed && !reachedAesa) state = "skipped";
        // Withdrawn before the claim was sent: nothing after preparing happened.
        if (i.status === "withdrawn" && !i.submittedAt && n > 0) state = "skipped";
      }
      return [stage, state];
    }),
  ) as Record<ClaimStage, StageState>;

  return {
    current,
    states,
    outcome: closed ? (i.status as ClaimOutcome) : undefined,
    inCourt: i.status === "escalated_court" || undefined,
    due: current === "airline_wait" && i.submittedAt ? airlineReplyDue(i.submittedAt) : undefined,
  };
}
