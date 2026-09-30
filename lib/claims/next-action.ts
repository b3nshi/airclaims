import { airlineReplyDue, aesaAvailable } from "@/lib/eligibility";
import type { ClaimStatus, ContactChannel } from "@/lib/supabase/database.types";

export type NextActionKind =
  | "finish_draft"
  | "approve_email"
  | "respond_to_airline"
  | "submit_web_form"
  | "preparing_email"
  | "no_channel"
  | "validating"
  | "wait_airline"
  | "airline_overdue"
  | "read_reply"
  | "wait_aesa"
  | "in_court"
  | "check_payment"
  | "consider_court"
  | "none";

export type NextAction = { kind: NextActionKind; due?: string; aesaUntil?: string };

export type NextActionInput = {
  status: ClaimStatus;
  channel: ContactChannel | null; // airline's preferred compensation channel
  hasPendingApproval: boolean; // an outbound draft waits for the user's approval
  airlineAnswerToHandle?: boolean; // an analysed airline answer the passenger hasn't replied to
  submittedAt: string | null;
  aesaDeadline: string | null;
  flightDate: string;
  today: string; // YYYY-MM-DD
};

/** The single most useful thing the user can do now. Pure, so it's unit-tested. */
export function nextAction(i: NextActionInput): NextAction {
  const aesaUntil = i.aesaDeadline && aesaAvailable(i.flightDate) ? i.aesaDeadline : undefined;
  const closed = ["won", "partially_won", "lost", "withdrawn"].includes(i.status);

  // Waiting on the user always comes first: nothing is sent without their approval.
  if (i.hasPendingApproval && !closed && i.status !== "draft") return { kind: "approve_email" };
  if (i.airlineAnswerToHandle && (i.status === "submitted_airline" || i.status === "airline_replied")) {
    return { kind: "respond_to_airline", aesaUntil };
  }

  switch (i.status) {
    case "draft":
      return { kind: "finish_draft" };
    case "documents_pending":
    case "ready_to_submit":
      if (i.channel === "email") return { kind: "preparing_email" };
      if (i.channel === "web_form") return { kind: "submit_web_form" };
      return { kind: "no_channel" };
    case "validating":
      return { kind: "validating" };
    case "submitted_airline": {
      if (!i.submittedAt) return { kind: "wait_airline" };
      const due = airlineReplyDue(i.submittedAt);
      return i.today > due ? { kind: "airline_overdue", due, aesaUntil } : { kind: "wait_airline", due };
    }
    case "airline_replied":
      return { kind: "read_reply", aesaUntil };
    case "escalated_aesa":
      return { kind: "wait_aesa" };
    case "escalated_court":
      return { kind: "in_court" };
    case "won":
    case "partially_won":
      return { kind: "check_payment" };
    case "lost":
      return { kind: "consider_court" };
    case "withdrawn":
      return { kind: "none" };
  }
}
