export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_memories: {
        Row: {
          content: string
          created_at: string
          id: string
          kind: string
          slug: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          kind?: string
          slug: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          kind?: string
          slug?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      campaign_runs: {
        Row: {
          campaign_id: string
          created_at: string
          daily_send_cap: number
          error: string | null
          id: string
          last_step_at: string | null
          leads_drafted: number
          leads_enriched: number
          leads_failed: number
          leads_found: number
          leads_sent: number
          state: Database["public"]["Enums"]["run_state"]
          target_lead_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          daily_send_cap?: number
          error?: string | null
          id?: string
          last_step_at?: string | null
          leads_drafted?: number
          leads_enriched?: number
          leads_failed?: number
          leads_found?: number
          leads_sent?: number
          state?: Database["public"]["Enums"]["run_state"]
          target_lead_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          daily_send_cap?: number
          error?: string | null
          id?: string
          last_step_at?: string | null
          leads_drafted?: number
          leads_enriched?: number
          leads_failed?: number
          leads_found?: number
          leads_sent?: number
          state?: Database["public"]["Enums"]["run_state"]
          target_lead_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          auto_followup: boolean
          auto_send: boolean
          category: string | null
          channel: string
          city: string | null
          created_at: string
          discovery_source: string
          email_cap: number
          follow_up_days: number[]
          id: string
          keywords: string | null
          name: string
          offering_id: string | null
          social_cap: number
          status: string
          updated_at: string
          user_id: string
          whatsapp_cap: number
        }
        Insert: {
          auto_followup?: boolean
          auto_send?: boolean
          category?: string | null
          channel?: string
          city?: string | null
          created_at?: string
          discovery_source?: string
          email_cap?: number
          follow_up_days?: number[]
          id?: string
          keywords?: string | null
          name: string
          offering_id?: string | null
          social_cap?: number
          status?: string
          updated_at?: string
          user_id: string
          whatsapp_cap?: number
        }
        Update: {
          auto_followup?: boolean
          auto_send?: boolean
          category?: string | null
          channel?: string
          city?: string | null
          created_at?: string
          discovery_source?: string
          email_cap?: number
          follow_up_days?: number[]
          id?: string
          keywords?: string | null
          name?: string
          offering_id?: string | null
          social_cap?: number
          status?: string
          updated_at?: string
          user_id?: string
          whatsapp_cap?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "offerings"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_accounts: {
        Row: {
          channel: string
          created_at: string
          credentials: Json
          display_name: string
          external_id: string | null
          id: string
          metadata: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          credentials?: Json
          display_name: string
          external_id?: string | null
          id?: string
          metadata?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          credentials?: Json
          display_name?: string
          external_id?: string | null
          id?: string
          metadata?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      channel_messages: {
        Row: {
          body: string | null
          campaign_id: string | null
          channel: string
          channel_account_id: string | null
          created_at: string
          direction: string
          error: string | null
          from_address: string | null
          id: string
          lead_id: string | null
          payload: Json | null
          provider_message_id: string | null
          status: string
          subject: string | null
          to_address: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          campaign_id?: string | null
          channel: string
          channel_account_id?: string | null
          created_at?: string
          direction: string
          error?: string | null
          from_address?: string | null
          id?: string
          lead_id?: string | null
          payload?: Json | null
          provider_message_id?: string | null
          status?: string
          subject?: string | null
          to_address?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          campaign_id?: string | null
          channel?: string
          channel_account_id?: string | null
          created_at?: string
          direction?: string
          error?: string | null
          from_address?: string | null
          id?: string
          lead_id?: string | null
          payload?: Json | null
          provider_message_id?: string | null
          status?: string
          subject?: string | null
          to_address?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_messages_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: false
            referencedRelation: "channel_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          tool_call_id: string | null
          tool_calls: Json | null
          tool_name: string | null
          user_id: string
        }
        Insert: {
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          tool_call_id?: string | null
          tool_calls?: Json | null
          tool_name?: string | null
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          tool_call_id?: string | null
          tool_calls?: Json | null
          tool_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_briefings: {
        Row: {
          body: string
          briefing_date: string
          created_at: string
          id: string
          metrics: Json
          read_at: string | null
          user_id: string
        }
        Insert: {
          body?: string
          briefing_date: string
          created_at?: string
          id?: string
          metrics?: Json
          read_at?: string | null
          user_id: string
        }
        Update: {
          body?: string
          briefing_date?: string
          created_at?: string
          id?: string
          metrics?: Json
          read_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      intel_items: {
        Row: {
          acted_on: boolean
          created_at: string
          id: string
          matched_offerings: string[] | null
          posted_at: string | null
          published_at: string | null
          relevance_score: number | null
          source: string
          summary: string | null
          tags: string[] | null
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          acted_on?: boolean
          created_at?: string
          id?: string
          matched_offerings?: string[] | null
          posted_at?: string | null
          published_at?: string | null
          relevance_score?: number | null
          source: string
          summary?: string | null
          tags?: string[] | null
          title: string
          url?: string | null
          user_id: string
        }
        Update: {
          acted_on?: boolean
          created_at?: string
          id?: string
          matched_offerings?: string[] | null
          posted_at?: string | null
          published_at?: string | null
          relevance_score?: number | null
          source?: string
          summary?: string | null
          tags?: string[] | null
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          address: string | null
          business_name: string
          campaign_id: string | null
          contact_email: string | null
          contact_name: string | null
          created_at: string
          id: string
          last_activity_at: string | null
          notes: string | null
          phone: string | null
          reply_intent: string | null
          root_domain: string | null
          score: number
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          address?: string | null
          business_name: string
          campaign_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          id?: string
          last_activity_at?: string | null
          notes?: string | null
          phone?: string | null
          reply_intent?: string | null
          root_domain?: string | null
          score?: number
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          address?: string | null
          business_name?: string
          campaign_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          id?: string
          last_activity_at?: string | null
          notes?: string | null
          phone?: string | null
          reply_intent?: string | null
          root_domain?: string | null
          score?: number
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      offerings: {
        Row: {
          created_at: string
          demo_url: string | null
          id: string
          ideal_customer: string | null
          pricing: string | null
          problem_solved: string | null
          screenshot_url: string | null
          status: string
          tagline: string | null
          target_audience: string | null
          testimonial: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          demo_url?: string | null
          id?: string
          ideal_customer?: string | null
          pricing?: string | null
          problem_solved?: string | null
          screenshot_url?: string | null
          status?: string
          tagline?: string | null
          target_audience?: string | null
          testimonial?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          demo_url?: string | null
          id?: string
          ideal_customer?: string | null
          pricing?: string | null
          problem_solved?: string | null
          screenshot_url?: string | null
          status?: string
          tagline?: string | null
          target_audience?: string | null
          testimonial?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pitch_events: {
        Row: {
          channel: string
          created_at: string
          event_type: string
          id: string
          lead_id: string | null
          occurred_at: string
          payload: Json | null
          pitch_id: string | null
          provider: string
          provider_message_id: string | null
          recipient: string | null
          user_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          event_type: string
          id?: string
          lead_id?: string | null
          occurred_at?: string
          payload?: Json | null
          pitch_id?: string | null
          provider?: string
          provider_message_id?: string | null
          recipient?: string | null
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          event_type?: string
          id?: string
          lead_id?: string | null
          occurred_at?: string
          payload?: Json | null
          pitch_id?: string | null
          provider?: string
          provider_message_id?: string | null
          recipient?: string | null
          user_id?: string
        }
        Relationships: []
      }
      pitch_sequences: {
        Row: {
          campaign_id: string | null
          created_at: string
          id: string
          lead_id: string
          parent_pitch_id: string | null
          pitch_id: string | null
          reason: string | null
          scheduled_at: string
          sent_at: string | null
          status: string
          step: number
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          lead_id: string
          parent_pitch_id?: string | null
          pitch_id?: string | null
          reason?: string | null
          scheduled_at: string
          sent_at?: string | null
          status?: string
          step: number
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          parent_pitch_id?: string | null
          pitch_id?: string | null
          reason?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          step?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pitches: {
        Row: {
          body: string | null
          created_at: string
          id: string
          lead_id: string
          sent_at: string | null
          subject: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          lead_id: string
          sent_at?: string | null
          subject?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          sent_at?: string | null
          subject?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pitches_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      run_events: {
        Row: {
          campaign_id: string | null
          created_at: string
          id: string
          kind: string
          lead_id: string | null
          level: string
          message: string
          run_id: string | null
          user_id: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          kind: string
          lead_id?: string | null
          level?: string
          message: string
          run_id?: string | null
          user_id: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          lead_id?: string | null
          level?: string
          message?: string
          run_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "campaign_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          body: string | null
          created_at: string
          id: string
          name: string
          subject: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          name: string
          subject?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          name?: string
          subject?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      compute_lead_score: { Args: { _lead_id: string }; Returns: number }
      extract_root_domain: { Args: { url: string }; Returns: string }
    }
    Enums: {
      lead_status:
        | "new"
        | "enriched"
        | "drafted"
        | "sent"
        | "opened"
        | "replied"
        | "won"
        | "lost"
      run_state:
        | "queued"
        | "discovering"
        | "enriching"
        | "drafting"
        | "sending"
        | "paused"
        | "done"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      lead_status: [
        "new",
        "enriched",
        "drafted",
        "sent",
        "opened",
        "replied",
        "won",
        "lost",
      ],
      run_state: [
        "queued",
        "discovering",
        "enriching",
        "drafting",
        "sending",
        "paused",
        "done",
        "failed",
      ],
    },
  },
} as const
