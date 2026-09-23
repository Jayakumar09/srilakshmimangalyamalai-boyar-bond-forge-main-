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
      blocks: {
        Row: {
          created_at: string
          id: string
          target_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          target_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          target_id?: string
          user_id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          user_a: string
          user_b: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          user_a: string
          user_b: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          user_a?: string
          user_b?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          ai_check_notes: string | null
          ai_check_status: string | null
          ai_face_match_score: number | null
          created_at: string
          doc_type: string
          file_name: string | null
          id: string
          id_kind: string | null
          mime_type: string | null
          size_bytes: number | null
          storage_key: string
          user_id: string
          verified: boolean
        }
        Insert: {
          ai_check_notes?: string | null
          ai_check_status?: string | null
          ai_face_match_score?: number | null
          created_at?: string
          doc_type: string
          file_name?: string | null
          id?: string
          id_kind?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          storage_key: string
          user_id: string
          verified?: boolean
        }
        Update: {
          ai_check_notes?: string | null
          ai_check_status?: string | null
          ai_face_match_score?: number | null
          created_at?: string
          doc_type?: string
          file_name?: string | null
          id?: string
          id_kind?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          storage_key?: string
          user_id?: string
          verified?: boolean
        }
        Relationships: []
      }
      jathagam_requests: {
        Row: {
          birth_date: string
          birth_place: string
          birth_time: string
          created_at: string
          id: string
          notes: string | null
          payment_id: string | null
          report_file_name: string | null
          report_key: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          birth_date: string
          birth_place: string
          birth_time: string
          created_at?: string
          id?: string
          notes?: string | null
          payment_id?: string | null
          report_file_name?: string | null
          report_key?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          birth_date?: string
          birth_place?: string
          birth_time?: string
          created_at?: string
          id?: string
          notes?: string | null
          payment_id?: string | null
          report_file_name?: string | null
          report_key?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jathagam_requests_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      lookup_options: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          id: string
          value_en: string
          value_ta: string | null
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          value_en: string
          value_ta?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          value_en?: string
          value_ta?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          email_error: string | null
          email_to: string
          emailed: boolean
          id: string
          kind: string
          related_user_id: string | null
          subject: string
        }
        Insert: {
          body: string
          created_at?: string
          email_error?: string | null
          email_to: string
          emailed?: boolean
          id?: string
          kind: string
          related_user_id?: string | null
          subject: string
        }
        Update: {
          body?: string
          created_at?: string
          email_error?: string | null
          email_to?: string
          emailed?: boolean
          id?: string
          kind?: string
          related_user_id?: string | null
          subject?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          admin_notes: string | null
          amount_inr: number
          created_at: string
          gateway_order_id: string | null
          gateway_payment_id: string | null
          id: string
          item: Database["public"]["Enums"]["payment_item"]
          method: string
          proof_key: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
          user_id: string
          utr_reference: string | null
          verified_at: string | null
        }
        Insert: {
          admin_notes?: string | null
          amount_inr: number
          created_at?: string
          gateway_order_id?: string | null
          gateway_payment_id?: string | null
          id?: string
          item: Database["public"]["Enums"]["payment_item"]
          method: string
          proof_key?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          user_id: string
          utr_reference?: string | null
          verified_at?: string | null
        }
        Update: {
          admin_notes?: string | null
          amount_inr?: number
          created_at?: string
          gateway_order_id?: string | null
          gateway_payment_id?: string | null
          id?: string
          item?: Database["public"]["Enums"]["payment_item"]
          method?: string
          proof_key?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          user_id?: string
          utr_reference?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      profile_audit: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          created_at: string
          details: string | null
          id: string
          profile_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          details?: string | null
          id?: string
          profile_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          details?: string | null
          id?: string
          profile_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          about: string | null
          address_line: string | null
          admin_notes: string | null
          annual_income: string | null
          birth_place: string | null
          birth_time: string | null
          city: string | null
          client_profile_id: string | null
          consent_accepted_at: string | null
          created_at: string
          created_by_admin_id: string | null
          date_of_birth: string | null
          education_detail: string | null
          education_level: string | null
          email: string | null
          family_details: string | null
          family_status: string | null
          family_type: string | null
          father_name: string | null
          father_occupation: string | null
          full_name: string | null
          gender: string | null
          gothram: string | null
          height_cm: number | null
          id: string
          job_detail: string | null
          last_updated_at: string | null
          last_updated_by: string | null
          last_updated_by_type: string | null
          marital_status: string | null
          membership_plan: Database["public"]["Enums"]["membership_plan"]
          mother_name: string | null
          mother_occupation: string | null
          mother_tongue: string | null
          native_district: string | null
          phone: string | null
          photo_url: string | null
          pincode: string | null
          plan_valid_until: string | null
          pref_age_max: number | null
          pref_age_min: number | null
          pref_district: string | null
          pref_education: string | null
          pref_height_min_cm: number | null
          pref_marital_status: string | null
          pref_notes: string | null
          pref_profession: string | null
          pref_sub_caste: string | null
          profession: string | null
          profile_created_by: string
          siblings: string | null
          state: string | null
          status: Database["public"]["Enums"]["approval_status"]
          sub_caste: string | null
          caste: string | null
          brothers: number | null
          sisters: number | null
          submitted_at: string | null
          updated_at: string
          weight_kg: number | null
          whatsapp: string | null
        }
        Insert: {
          about?: string | null
          address_line?: string | null
          admin_notes?: string | null
          annual_income?: string | null
          birth_place?: string | null
          birth_time?: string | null
          city?: string | null
          client_profile_id?: string | null
          consent_accepted_at?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          date_of_birth?: string | null
          education_detail?: string | null
          education_level?: string | null
          email?: string | null
          family_details?: string | null
          family_status?: string | null
          family_type?: string | null
          father_name?: string | null
          father_occupation?: string | null
          full_name?: string | null
          gender?: string | null
          gothram?: string | null
          height_cm?: number | null
          id: string
          job_detail?: string | null
          last_updated_at?: string | null
          last_updated_by?: string | null
          last_updated_by_type?: string | null
          marital_status?: string | null
          membership_plan?: Database["public"]["Enums"]["membership_plan"]
          mother_name?: string | null
          mother_occupation?: string | null
          mother_tongue?: string | null
          native_district?: string | null
          phone?: string | null
          photo_url?: string | null
          pincode?: string | null
          plan_valid_until?: string | null
          pref_age_max?: number | null
          pref_age_min?: number | null
          pref_district?: string | null
          pref_education?: string | null
          pref_height_min_cm?: number | null
          pref_marital_status?: string | null
          pref_notes?: string | null
          pref_profession?: string | null
          pref_sub_caste?: string | null
          profession?: string | null
          profile_created_by?: string
          siblings?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          sub_caste?: string | null
          caste?: string | null
          brothers?: number | null
          sisters?: number | null
          submitted_at?: string | null
          updated_at?: string
          weight_kg?: number | null
          whatsapp?: string | null
        }
        Update: {
          about?: string | null
          address_line?: string | null
          admin_notes?: string | null
          annual_income?: string | null
          birth_place?: string | null
          birth_time?: string | null
          city?: string | null
          client_profile_id?: string | null
          consent_accepted_at?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          date_of_birth?: string | null
          education_detail?: string | null
          education_level?: string | null
          email?: string | null
          family_details?: string | null
          family_status?: string | null
          family_type?: string | null
          father_name?: string | null
          father_occupation?: string | null
          full_name?: string | null
          gender?: string | null
          gothram?: string | null
          height_cm?: number | null
          id?: string
          job_detail?: string | null
          last_updated_at?: string | null
          last_updated_by?: string | null
          last_updated_by_type?: string | null
          marital_status?: string | null
          membership_plan?: Database["public"]["Enums"]["membership_plan"]
          mother_name?: string | null
          mother_occupation?: string | null
          mother_tongue?: string | null
          native_district?: string | null
          phone?: string | null
          photo_url?: string | null
          pincode?: string | null
          plan_valid_until?: string | null
          pref_age_max?: number | null
          pref_age_min?: number | null
          pref_district?: string | null
          pref_education?: string | null
          pref_height_min_cm?: number | null
          pref_marital_status?: string | null
          pref_notes?: string | null
          pref_profession?: string | null
          pref_sub_caste?: string | null
          profession?: string | null
          profile_created_by?: string
          siblings?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          sub_caste?: string | null
          caste?: string | null
          brothers?: number | null
          sisters?: number | null
          submitted_at?: string | null
          updated_at?: string
          weight_kg?: number | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          reason: string
          reporter_id: string
          status: string
          target_id: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reporter_id: string
          status?: string
          target_id: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reporter_id?: string
          status?: string
          target_id?: string
        }
        Relationships: []
      }
      shortlists: {
        Row: {
          created_at: string
          id: string
          target_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          target_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          target_id?: string
          user_id?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          attachment_key: string | null
          attachment_mime: string | null
          attachment_name: string | null
          attachment_size: number | null
          body: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
          sender_type: string
          thread_id: string
        }
        Insert: {
          attachment_key?: string | null
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_size?: number | null
          body: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
          sender_type?: string
          thread_id: string
        }
        Update: {
          attachment_key?: string | null
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_size?: number | null
          body?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
          sender_type?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "support_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      support_threads: {
        Row: {
          channel: string
          created_at: string
          id: string
          last_message_at: string
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          last_message_at?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          last_message_at?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_message: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "client"
      approval_status: "pending" | "approved" | "rejected"
      membership_plan: "free" | "standard" | "premium"
      payment_item: "standard" | "premium" | "jathagam"
      payment_status: "submitted" | "verified" | "rejected"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "client"],
      approval_status: ["pending", "approved", "rejected"],
      membership_plan: ["free", "standard", "premium"],
      payment_item: ["standard", "premium", "jathagam"],
      payment_status: ["submitted", "verified", "rejected"],
    },
  },
} as const
