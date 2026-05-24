/**
 * Типы схемы Supabase (public) для HR Control Tower.
 *
 * Составлено вручную по миграции supabase/migrations/20260522120000_initial_schema.sql
 * в формате, совместимом с `supabase gen types typescript`. После подключения CLI
 * файл можно перегенерировать командой:
 *   supabase gen types typescript --linked > src/types/database.ts
 *
 * Замечания по типам:
 *  - text-колонки с CHECK (роли, статусы, source) типизированы как `string` —
 *    именно так их выводит gen types (CHECK не создаёт enum). Доменные union-типы
 *    живут в src/types/index.ts.
 *  - GENERATED-колонка vacancies.days_to_close присутствует только в Row
 *    (её нельзя писать в Insert/Update).
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string;
          full_name: string;
          role: string;
          email: string;
          hh_access_token: string | null;
          hh_refresh_token: string | null;
          hh_token_expires_at: string | null;
          hh_manager_id: string | null;
          mango_extension: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          role?: string;
          email: string;
          hh_access_token?: string | null;
          hh_refresh_token?: string | null;
          hh_token_expires_at?: string | null;
          hh_manager_id?: string | null;
          mango_extension?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          role?: string;
          email?: string;
          hh_access_token?: string | null;
          hh_refresh_token?: string | null;
          hh_token_expires_at?: string | null;
          hh_manager_id?: string | null;
          mango_extension?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_profiles_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      vacancies: {
        Row: {
          id: string;
          hh_vacancy_id: string | null;
          title: string;
          department: string | null;
          subdivision: string | null;
          location: string | null;
          customer_name: string | null;
          positions_count: number | null;
          manager_id: string;
          status: string;
          opened_at: string;
          closed_at: string | null;
          days_to_close: number | null;
          google_sheet_row: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          hh_vacancy_id?: string | null;
          title: string;
          department?: string | null;
          subdivision?: string | null;
          location?: string | null;
          customer_name?: string | null;
          positions_count?: number | null;
          manager_id: string;
          status?: string;
          opened_at?: string;
          closed_at?: string | null;
          google_sheet_row?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          hh_vacancy_id?: string | null;
          title?: string;
          department?: string | null;
          subdivision?: string | null;
          location?: string | null;
          customer_name?: string | null;
          positions_count?: number | null;
          manager_id?: string;
          status?: string;
          opened_at?: string;
          closed_at?: string | null;
          google_sheet_row?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'vacancies_manager_id_fkey';
            columns: ['manager_id'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      vacancy_snapshots: {
        Row: {
          id: string;
          vacancy_id: string;
          snapshot_at: string;
          responses_count: number;
          contacts_opened: number;
          invitations_from_responses: number;
          invitations_from_db: number | null;
          calls_count: number | null;
          views_count: number;
          source: string;
          is_locked: boolean;
          is_closed: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          vacancy_id: string;
          snapshot_at?: string;
          responses_count?: number;
          contacts_opened?: number;
          invitations_from_responses?: number;
          invitations_from_db?: number | null;
          calls_count?: number | null;
          views_count?: number;
          source?: string;
          is_locked?: boolean;
          is_closed?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          vacancy_id?: string;
          snapshot_at?: string;
          responses_count?: number;
          contacts_opened?: number;
          invitations_from_responses?: number;
          invitations_from_db?: number | null;
          calls_count?: number | null;
          views_count?: number;
          source?: string;
          is_locked?: boolean;
          is_closed?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'vacancy_snapshots_vacancy_id_fkey';
            columns: ['vacancy_id'];
            isOneToOne: false;
            referencedRelation: 'vacancies';
            referencedColumns: ['id'];
          },
        ];
      };
      daily_activities: {
        Row: {
          id: string;
          manager_id: string;
          activity_date: string;
          mango_calls_count: number | null;
          mango_calls_source: string;
          hh_calls_count: number | null;
          hh_calls_source: string;
          interviews_count: number;
          offers_count: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          manager_id: string;
          activity_date: string;
          mango_calls_count?: number | null;
          mango_calls_source?: string;
          hh_calls_count?: number | null;
          hh_calls_source?: string;
          interviews_count?: number;
          offers_count?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          manager_id?: string;
          activity_date?: string;
          mango_calls_count?: number | null;
          mango_calls_source?: string;
          hh_calls_count?: number | null;
          hh_calls_source?: string;
          interviews_count?: number;
          offers_count?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'daily_activities_manager_id_fkey';
            columns: ['manager_id'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      hired_employees: {
        Row: {
          id: string;
          sheet_row_id: number;
          vacancy_id: string | null;
          position_name: string;
          hired_date: string;
          employment_type: string;
          status: string; // 'hired' | 'probation'
          manager_name_sheet: string | null;
          synced_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sheet_row_id: number;
          vacancy_id?: string | null;
          position_name: string;
          hired_date: string;
          employment_type?: string;
          status?: string;
          manager_name_sheet?: string | null;
          synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sheet_row_id?: number;
          vacancy_id?: string | null;
          position_name?: string;
          hired_date?: string;
          employment_type?: string;
          status?: string;
          manager_name_sheet?: string | null;
          synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'hired_employees_vacancy_id_fkey';
            columns: ['vacancy_id'];
            isOneToOne: false;
            referencedRelation: 'vacancies';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_insights: {
        Row: {
          id: string;
          insight_type: string;
          period_start: string;
          period_end: string;
          manager_id: string | null;
          vacancy_id: string | null;
          severity: string | null;
          title: string;
          body_md: string;
          meta_json: Json | null;
          is_read: boolean;
          tokens_used: number | null;
          triggered_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          insight_type: string;
          period_start: string;
          period_end: string;
          manager_id?: string | null;
          vacancy_id?: string | null;
          severity?: string | null;
          title: string;
          body_md: string;
          meta_json?: Json | null;
          is_read?: boolean;
          tokens_used?: number | null;
          triggered_by?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          insight_type?: string;
          period_start?: string;
          period_end?: string;
          manager_id?: string | null;
          vacancy_id?: string | null;
          severity?: string | null;
          title?: string;
          body_md?: string;
          meta_json?: Json | null;
          is_read?: boolean;
          tokens_used?: number | null;
          triggered_by?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_insights_manager_id_fkey';
            columns: ['manager_id'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_insights_vacancy_id_fkey';
            columns: ['vacancy_id'];
            isOneToOne: false;
            referencedRelation: 'vacancies';
            referencedColumns: ['id'];
          },
        ];
      };
      hr_manager_syncs: {
        Row: {
          id: string;
          sheet_full_name: string;
          user_profile_id: string | null;
          email_sheet: string | null;
          is_active_sheet: boolean;
          hh_manager_id: string | null;
          synced_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sheet_full_name: string;
          user_profile_id?: string | null;
          email_sheet?: string | null;
          is_active_sheet?: boolean;
          hh_manager_id?: string | null;
          synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sheet_full_name?: string;
          user_profile_id?: string | null;
          email_sheet?: string | null;
          is_active_sheet?: boolean;
          hh_manager_id?: string | null;
          synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'hr_manager_syncs_user_profile_id_fkey';
            columns: ['user_profile_id'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      bonus_rates: {
        Row: {
          id: string;
          position_name: string;
          amount_kopecks: number;
          group_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          position_name: string;
          amount_kopecks: number;
          group_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          position_name?: string;
          amount_kopecks?: number;
          group_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      hr_bonuses: {
        Row: {
          id: string;
          sheet_row_id: number;
          manager_sync_id: string | null;
          manager_id: string | null;
          vacancy_id: string | null;
          vacancy_title_sheet: string;
          manager_name_sheet: string;
          bonus_amount_kopecks: number;
          bonus_date: string;
          status: string;
          synced_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sheet_row_id: number;
          manager_sync_id?: string | null;
          manager_id?: string | null;
          vacancy_id?: string | null;
          vacancy_title_sheet: string;
          manager_name_sheet: string;
          bonus_amount_kopecks: number;
          bonus_date: string;
          status?: string;
          synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sheet_row_id?: number;
          manager_sync_id?: string | null;
          manager_id?: string | null;
          vacancy_id?: string | null;
          vacancy_title_sheet?: string;
          manager_name_sheet?: string;
          bonus_amount_kopecks?: number;
          bonus_date?: string;
          status?: string;
          synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'hr_bonuses_manager_sync_id_fkey';
            columns: ['manager_sync_id'];
            isOneToOne: false;
            referencedRelation: 'hr_manager_syncs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'hr_bonuses_manager_id_fkey';
            columns: ['manager_id'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'hr_bonuses_vacancy_id_fkey';
            columns: ['vacancy_id'];
            isOneToOne: false;
            referencedRelation: 'vacancies';
            referencedColumns: ['id'];
          },
        ];
      };
      hh_manager_stats: {
        Row: {
          id: string;
          manager_id: string | null;
          manager_name_hh: string | null;
          stat_date: string;
          hh_calls_count: number | null;
          responses_received: number | null;
          responses_viewed: number | null;
          responses_answered: number | null;
          resume_views_from_search: number | null;
          invitations_from_db: number | null;
          politeness_index: number | null;
          avg_response_hours: number | null;
          source_csv: string;
          synced_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          manager_id?: string | null;
          manager_name_hh?: string | null;
          stat_date: string;
          hh_calls_count?: number | null;
          responses_received?: number | null;
          responses_viewed?: number | null;
          responses_answered?: number | null;
          resume_views_from_search?: number | null;
          invitations_from_db?: number | null;
          politeness_index?: number | null;
          avg_response_hours?: number | null;
          source_csv: string;
          synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          manager_id?: string | null;
          manager_name_hh?: string | null;
          stat_date?: string;
          hh_calls_count?: number | null;
          responses_received?: number | null;
          responses_viewed?: number | null;
          responses_answered?: number | null;
          resume_views_from_search?: number | null;
          invitations_from_db?: number | null;
          politeness_index?: number | null;
          avg_response_hours?: number | null;
          source_csv?: string;
          synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'hh_manager_stats_manager_id_fkey';
            columns: ['manager_id'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      manager_plans: {
        Row: {
          id: string;
          manager_id: string;
          effective_from: string;
          calls_per_day: number;
          interviews_per_day: number;
          hires_per_month: number;
          vacancies_limit: number;
          set_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          manager_id: string;
          effective_from?: string;
          calls_per_day?: number;
          interviews_per_day?: number;
          hires_per_month?: number;
          vacancies_limit?: number;
          set_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          manager_id?: string;
          effective_from?: string;
          calls_per_day?: number;
          interviews_per_day?: number;
          hires_per_month?: number;
          vacancies_limit?: number;
          set_by?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'manager_plans_manager_id_fkey';
            columns: ['manager_id'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'manager_plans_set_by_fkey';
            columns: ['set_by'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      staffing_records: {
        Row: {
          id: string;
          staffing_pct: number;
          comment: string | null;
          recorded_by: string;
          recorded_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          staffing_pct: number;
          comment?: string | null;
          recorded_by: string;
          recorded_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          staffing_pct?: number;
          comment?: string | null;
          recorded_by?: string;
          recorded_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'staffing_records_recorded_by_fkey';
            columns: ['recorded_by'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      sync_logs: {
        Row: {
          id: string;
          source: string;
          status: string;
          records_total: number;
          records_updated: number;
          error_code: string | null;
          error_message: string | null;
          triggered_by: string;
          started_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          source: string;
          status: string;
          records_total?: number;
          records_updated?: number;
          error_code?: string | null;
          error_message?: string | null;
          triggered_by?: string;
          started_at?: string;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          source?: string;
          status?: string;
          records_total?: number;
          records_updated?: number;
          error_code?: string | null;
          error_message?: string | null;
          triggered_by?: string;
          started_at?: string;
          finished_at?: string | null;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          user_role: string | null;
          table_name: string;
          record_id: string;
          action: string;
          old_values: Json | null;
          new_values: Json | null;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          user_role?: string | null;
          table_name: string;
          record_id: string;
          action: string;
          old_values?: Json | null;
          new_values?: Json | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          user_role?: string | null;
          table_name?: string;
          record_id?: string;
          action?: string;
          old_values?: Json | null;
          new_values?: Json | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_logs_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      error_logs: {
        Row: {
          id: string;
          source: string;
          severity: string;
          error_code: string | null;
          message: string;
          stack_trace: string | null;
          context: Json | null;
          user_id: string | null;
          http_method: string | null;
          http_path: string | null;
          http_status: number | null;
          resolved: boolean;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          source: string;
          severity?: string;
          error_code?: string | null;
          message: string;
          stack_trace?: string | null;
          context?: Json | null;
          user_id?: string | null;
          http_method?: string | null;
          http_path?: string | null;
          http_status?: number | null;
          resolved?: boolean;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          source?: string;
          severity?: string;
          error_code?: string | null;
          message?: string;
          stack_trace?: string | null;
          context?: Json | null;
          user_id?: string | null;
          http_method?: string | null;
          http_path?: string | null;
          http_status?: number | null;
          resolved?: boolean;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'error_logs_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'error_logs_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      fuzzy_match_vacancy: {
        Args: {
          search_title: string;
          threshold?: number;
        };
        Returns: {
          id: string;
          title: string;
          similarity_score: number;
        }[];
      };
      find_vacancy_by_title: {
        Args: {
          position_name: string;
          similarity_threshold?: number;
        };
        Returns: string;
      };
      compute_manager_bonuses: {
        Args: {
          p_from: string;
          p_to: string;
          p_manager_id?: string | null;
          p_threshold?: number;
        };
        Returns: {
          hired_id: string;
          manager_id: string | null;
          manager_name: string | null;
          manager_is_active: boolean | null;
          vacancy_id: string | null;
          vacancy_title: string | null;
          position_name: string;
          hired_date: string;
          rate_id: string | null;
          rate_position_name: string | null;
          amount_kopecks: number | null;
          similarity_score: number | null;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
