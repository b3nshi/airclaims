// Hand-maintained from supabase/migrations until `pnpm db:types` is run against the
// linked project (which overwrites this file with the full generated types).
type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type DisruptionType = "delay" | "cancellation" | "denied_boarding" | "missed_connection";
export type ClaimStatus =
  | "draft" | "documents_pending" | "validating" | "ready_to_submit" | "submitted_airline" | "airline_replied"
  | "escalated_aesa" | "escalated_court" | "won" | "partially_won" | "lost" | "withdrawn";
export type ExpenseCategory = "ground_transport" | "meal" | "hotel" | "phone" | "rebooking" | "other";
export type DocumentType =
  | "boarding_pass" | "booking_confirmation" | "id_document" | "receipt" | "airline_correspondence" | "other";
export type ValidationStatus = "pending" | "passed" | "needs_review" | "failed";
export type AgreementType = "terms_of_service" | "privacy_notice" | "email_authorization" | "story_publication";
export type ContactChannel = "email" | "web_form" | "postal" | "phone";
export type ContactPurpose = "compensation" | "expenses" | "refund" | "baggage" | "general" | "legal";
export type RiskFlagType =
  | "severe_weather" | "atc_strike" | "airport_strike" | "airline_staff_strike" | "atc_restriction" | "security" | "other";

export type ProfileRow = {
  id: string;
  full_name: string | null;
  preferred_locale: string;
  personal_email: string | null;
  referral_code: string;
  referred_by: string | null;
  marketing_consent: boolean;
  created_at: string;
  updated_at: string;
};

export type AirportRow = {
  iata: string;
  icao: string | null;
  name: string;
  city: string | null;
  country_code: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  eu261_scope: boolean;
  monitored: boolean;
};

export type AirlineRow = {
  id: string;
  iata: string | null;
  icao: string | null;
  name: string;
  group_id: string | null;
  country_code: string | null;
  is_eu_carrier: boolean;
  preferred_language: string;
  logo_path: string | null;
  website: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AirlineContactRow = {
  id: string;
  airline_id: string;
  purpose: ContactPurpose;
  channel: ContactChannel;
  label: string;
  value: string;
  submission_steps: Json;
  language: string | null;
  notes: string | null;
  verified_at: string | null;
};

export type FlightRow = {
  id: string;
  flight_iata: string;
  flight_date: string;
  airline_id: string | null;
  dep_iata: string | null;
  arr_iata: string | null;
  scheduled_dep: string | null;
  actual_dep: string | null;
  scheduled_arr: string | null;
  actual_arr: string | null;
  arrival_delay_minutes: number | null;
  status: string | null;
  distance_km: number | null;
  candidate: "none" | "possible" | "candidate";
  data_status: "provisional" | "final";
  source: string;
  last_checked_at: string | null;
  created_at: string;
};

export type FlightRiskFlagRow = {
  id: string;
  flight_id: string;
  flag_type: RiskFlagType;
  excuses_airline: boolean;
  evidence: Json;
  created_at: string;
};

export type ClaimRow = {
  id: string;
  owner_id: string;
  flight_id: string | null;
  airline_id: string | null;
  flight_iata: string;
  flight_date: string;
  dep_iata: string | null;
  arr_iata: string | null;
  final_destination_iata: string | null;
  booking_reference: string | null;
  disruption: DisruptionType;
  reported_arrival_delay_minutes: number | null;
  cancellation_notice_days: number | null;
  care_provided: Json;
  airline_instructions: string | null;
  reason_given_by_airline: string | null;
  alias_code: string;
  status: ClaimStatus;
  compensation_eur: number | null;
  expenses_total_eur: number;
  airline_claim_reference: string | null;
  submitted_airline_at: string | null;
  aesa_deadline: string | null;
  resolved_at: string | null;
  amount_received_eur: number | null;
  fee_pct_locked: number | null;
  reported_scheduled_dep_local: string | null;
  reported_scheduled_arr_local: string | null;
  reported_actual_dep_local: string | null;
  reported_actual_arr_local: string | null;
  arrival_time_estimated: boolean;
  created_at: string;
  updated_at: string;
};

// Columns users may write (column grants in migration 0003).
type ClaimWritable = Pick<
  ClaimRow,
  | "flight_iata" | "flight_date" | "airline_id" | "flight_id" | "dep_iata" | "arr_iata" | "final_destination_iata"
  | "booking_reference" | "disruption" | "reported_arrival_delay_minutes" | "cancellation_notice_days"
  | "care_provided" | "airline_instructions" | "reason_given_by_airline" | "compensation_eur"
  | "reported_scheduled_dep_local" | "reported_scheduled_arr_local" | "reported_actual_dep_local"
  | "reported_actual_arr_local" | "arrival_time_estimated"
>;

export type ClaimPassengerRow = {
  id: string;
  claim_id: string;
  full_name: string;
  is_lead: boolean;
  is_infant_free: boolean;
  compensation_eur: number | null;
};

export type ClaimExpenseRow = {
  id: string;
  claim_id: string;
  category: ExpenseCategory;
  amount: number;
  currency: string;
  spent_at: string | null;
  description: string | null;
  airline_promised: boolean;
  promise_details: string | null;
  document_id: string | null;
};

export type DocumentRow = {
  id: string;
  claim_id: string;
  owner_id: string;
  doc_type: DocumentType;
  storage_path: string;
  mime_type: string | null;
  sha256: string | null;
  validation: ValidationStatus;
  extracted: Json | null;
  validation_result: Json | null;
  retention_until: string | null;
  created_at: string;
};

export type AgreementRow = {
  id: string;
  user_id: string;
  claim_id: string | null;
  kind: AgreementType;
  version: string;
  locale: string;
  signed_name: string;
  signed_at: string;
  ip_address: string | null;
  user_agent: string | null;
  document_sha256: string;
};

export type EmailStatus =
  | "draft" | "pending_approval" | "approved" | "sending" | "sent" | "failed" | "received" | "forwarded" | "ignored";
export type EmailClass = "user" | "airline" | "aesa" | "court" | "spam" | "other" | "unclassified";

// my_emails view: exact addresses are null until an outbound message has been sent.
export type MyEmailRow = {
  id: string;
  claim_id: string;
  direction: "inbound" | "outbound";
  status: EmailStatus;
  classification: EmailClass;
  from_address: string | null;
  to_addresses: string[] | null;
  recipient_label: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  attachments: Json;
  ai_summary: string | null;
  approved_at: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
};

export type ClaimEventRow = {
  id: number;
  claim_id: string;
  event_type: string;
  payload: Json;
  actor: string;
  created_at: string;
};

export type AirlineKnowledgeRow = {
  airline_id: string;
  passenger_tips: Json;
  drafting_notes: string | null;
  claim_form_notes: string | null;
  attachments_max_mb: number | null;
  stated_reply_days: number | null;
  typical_reply_days_min: number | null;
  typical_reply_days_max: number | null;
  offers_credit_first: boolean | null;
  updated_at: string;
  updated_by: string | null;
};

export type InsightTopic =
  | "claim_process" | "payment_practice" | "response_time" | "rejection_pattern" | "punctuality" | "escalation" | "tip" | "other";
export type InsightReliability = "official" | "enforcement_body" | "competitor" | "forum" | "own_data";

export type AirlineInsightRow = {
  id: string;
  airline_id: string;
  topic: InsightTopic;
  summary: string;
  source_name: string;
  source_url: string | null;
  reliability: InsightReliability;
  observed_on: string;
  verified: boolean;
  created_by: string | null;
  created_at: string;
};

export type ReviewQueueRow = {
  id: string;
  kind: "unmatched_email" | "user_email" | "support_email" | "email_needs_attention" | "email_draft_failed";
  email_id: string | null;
  claim_id: string | null;
  status: "open" | "done";
  note: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type AuditLogRow = {
  id: number;
  actor_id: string | null;
  table_name: string;
  row_id: string | null;
  action: string;
  before: Json | null;
  after: Json | null;
  created_at: string;
};

export type EmailRow = Omit<MyEmailRow, "from_address" | "to_addresses"> & {
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  message_id: string | null;
  in_reply_to: string | null;
};

export type AirlineStatsRow = {
  airline_id: string;
  iata: string | null;
  name: string;
  claims_total: number;
  claims_open: number;
  submitted: number;
  won: number;
  partially_won: number;
  lost: number;
  withdrawn: number;
  success_rate_pct: number | null;
  replies: number;
  avg_days_first_reply: number | null;
  median_days_first_reply: number | null;
  overdue_replies: number;
  avg_days_to_resolution: number | null;
  offers_total: number;
  offers_credit: number;
  offers_money_partial: number;
  offers_money_full: number;
  flights_3h_plus: number;
  knowledge_updated_at: string | null;
  contacts_last_verified: string | null;
};

export type AirlineResponseChannel = "web_form" | "email" | "letter" | "phone" | "chat" | "other";

// AI reading of an airline answer (n8n/src/airline-response/system-prompt.md).
export type AirlineResponseAnalysis = {
  kind: "auto_rejection" | "rejection" | "offer" | "request_info" | "acknowledgement" | "payment_confirmed" | "other";
  airline_position: string;
  reasons: { code: string; detail: string }[];
  airline_measured_delay_minutes: number | null;
  conflicts: string[];
  options: { code: string; recommended: boolean; explanation: string }[];
  aesa_advice: string;
  summary: string;
};

export type AirlineResponseRow = {
  id: string;
  claim_id: string;
  reported_by: string;
  channel: AirlineResponseChannel;
  received_on: string;
  airline_text: string | null;
  user_explanation: string | null;
  status: "pending" | "analyzed" | "failed";
  analysis: Json | null;
  analyzed_at: string | null;
  created_at: string;
  source: "reported" | "forwarded" | "inbound";
  email_id: string | null;
  attempts: number;
  locked_at: string | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        ProfileRow,
        never,
        Partial<Pick<ProfileRow, "full_name" | "preferred_locale" | "personal_email" | "marketing_consent">>
      >;
      airports: Table<AirportRow, never, never>;
      airlines: Table<AirlineRow, Partial<AirlineRow> & Pick<AirlineRow, "name">>;
      airline_contacts: Table<
        AirlineContactRow,
        Omit<AirlineContactRow, "id" | "verified_at" | "submission_steps" | "language" | "notes"> & Partial<AirlineContactRow>
      >;
      airline_knowledge: Table<AirlineKnowledgeRow, Partial<AirlineKnowledgeRow> & Pick<AirlineKnowledgeRow, "airline_id">>;
      airline_insights: Table<
        AirlineInsightRow,
        Omit<AirlineInsightRow, "id" | "created_at" | "observed_on" | "verified" | "created_by"> & Partial<AirlineInsightRow>
      >;
      review_queue: Table<ReviewQueueRow, never>;
      admin_audit_log: Table<AuditLogRow, never, never>;
      airline_responses: Table<AirlineResponseRow, never, never>;
      emails: Table<EmailRow, never, never>;
      flights: Table<FlightRow, never, never>;
      flight_risk_flags: Table<FlightRiskFlagRow, never, never>;
      claims: Table<
        ClaimRow,
        Partial<ClaimWritable> & Pick<ClaimRow, "owner_id" | "flight_iata" | "flight_date">,
        Partial<ClaimWritable>
      >;
      claim_passengers: Table<ClaimPassengerRow, Omit<ClaimPassengerRow, "id" | "compensation_eur"> & Partial<ClaimPassengerRow>>;
      claim_expenses: Table<
        ClaimExpenseRow,
        Pick<ClaimExpenseRow, "claim_id" | "category" | "amount"> & Partial<ClaimExpenseRow>
      >;
      documents: Table<
        DocumentRow,
        Pick<DocumentRow, "claim_id" | "owner_id" | "doc_type" | "storage_path"> &
          Partial<Pick<DocumentRow, "mime_type" | "sha256">>,
        never
      >;
      claim_events: Table<ClaimEventRow, never, never>;
      agreements: Table<
        AgreementRow,
        Omit<AgreementRow, "id" | "signed_at"> & Partial<Pick<AgreementRow, "signed_at">>,
        never
      >;
    };
    Views: {
      my_emails: { Row: MyEmailRow; Relationships: [] };
    };
    Functions: {
      compute_fee_pct: { Args: { p_claim_id: string }; Returns: number };
      submit_claim: { Args: { p_claim_id: string }; Returns: ClaimStatus };
      record_airline_submission: { Args: { p_claim_id: string; p_reference: string | null }; Returns: undefined };
      approve_email: { Args: { p_email_id: string }; Returns: undefined };
      withdraw_claim: { Args: { p_claim_id: string }; Returns: undefined };
      update_email_draft: { Args: { p_email_id: string; p_subject: string; p_body: string }; Returns: undefined };
      discard_email_draft: { Args: { p_email_id: string }; Returns: undefined };
      airline_passenger_tips: { Args: { p_airline_id: string; p_locale: string }; Returns: string[] };
      admin_airline_stats: { Args: Record<string, never>; Returns: AirlineStatsRow[] };
      admin_resolve_review: { Args: { p_id: string; p_note: string | null }; Returns: undefined };
      report_airline_response: {
        Args: { p_claim_id: string; p_channel: string; p_received_on: string; p_airline_text: string | null; p_explanation: string | null };
        Returns: string;
      };
      retry_airline_response: { Args: { p_response_id: string }; Returns: undefined };
      mark_aesa_filed: { Args: { p_claim_id: string; p_filed_on: string; p_reference: string | null }; Returns: undefined };
      record_claim_outcome: {
        Args: { p_claim_id: string; p_outcome: "won" | "partially_won" | "lost"; p_amount_received: number | null };
        Returns: undefined;
      };
      record_expenses_submission: { Args: { p_claim_id: string; p_reference: string | null }; Returns: undefined };
      admin_upsert_flight: { Args: { p: Json }; Returns: string };
      admin_link_email_to_claim: { Args: { p_email_id: string; p_alias_code: string }; Returns: string };
      request_flight_check: { Args: { p_flight_iata: string; p_flight_date: string }; Returns: Json };
      airline_claim_channels: {
        Args: { p_airline_id: string };
        Returns: { channel: ContactChannel; label: string }[];
      };
    };
    Enums: {
      disruption_type: DisruptionType;
      claim_status: ClaimStatus;
      expense_category: ExpenseCategory;
      document_type: DocumentType;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type { Json };
