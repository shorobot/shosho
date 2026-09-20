// Placeholder until CI generates the real file (supabase gen types typescript). Replaced in the same PR.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type Database = {
  public: {
    Tables: Record<string, { Row: Record<string, any>; Insert: Record<string, any>; Update: Record<string, any>; Relationships: [] }>;
    Views: Record<string, { Row: Record<string, any> }>;
    Functions: Record<string, { Args: Record<string, any>; Returns: any }>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, never>;
  };
};
