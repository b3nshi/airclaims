// Hand-maintained subset until the project is linked; regenerate with `pnpm db:types`.
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
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
        Insert: never; // created by the on_auth_user_created trigger
        Update: {
          full_name?: string | null;
          preferred_locale?: string;
          personal_email?: string | null;
          marketing_consent?: boolean;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
