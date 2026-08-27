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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: string | null
          organization_id: string
          target_id: string
          target_type: string
          workspace_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: string | null
          organization_id: string
          target_id: string
          target_type: string
          workspace_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: string | null
          organization_id?: string
          target_id?: string
          target_type?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "activity_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_authority_audit: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          id: string
          metadata: Json
          new_role: string | null
          new_status: string | null
          organization_id: string | null
          previous_role: string | null
          previous_status: string | null
          reason: string | null
          target_email: string | null
          target_user_id: string | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          created_at?: string
          id?: string
          metadata?: Json
          new_role?: string | null
          new_status?: string | null
          organization_id?: string | null
          previous_role?: string | null
          previous_status?: string | null
          reason?: string | null
          target_email?: string | null
          target_user_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          new_role?: string | null
          new_status?: string | null
          organization_id?: string | null
          previous_role?: string | null
          previous_status?: string | null
          reason?: string | null
          target_email?: string | null
          target_user_id?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      adoption_initiatives: {
        Row: {
          adoption_plan_id: string
          created_at: string
          created_by: string | null
          id: string
          is_archived: boolean
          name: string
          organization_id: string
          owner_id: string | null
          priority: Database["public"]["Enums"]["pm_priority"]
          project_id: string
          readiness_area: Database["public"]["Enums"]["adoption_readiness_area"]
          sort_order: number
          status: Database["public"]["Enums"]["adoption_initiative_status"]
          summary: string | null
          target_date: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          adoption_plan_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_archived?: boolean
          name: string
          organization_id: string
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["pm_priority"]
          project_id: string
          readiness_area: Database["public"]["Enums"]["adoption_readiness_area"]
          sort_order?: number
          status?: Database["public"]["Enums"]["adoption_initiative_status"]
          summary?: string | null
          target_date?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          adoption_plan_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          organization_id?: string
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["pm_priority"]
          project_id?: string
          readiness_area?: Database["public"]["Enums"]["adoption_readiness_area"]
          sort_order?: number
          status?: Database["public"]["Enums"]["adoption_initiative_status"]
          summary?: string | null
          target_date?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adoption_initiatives_adoption_plan_id_fkey"
            columns: ["adoption_plan_id"]
            isOneToOne: false
            referencedRelation: "adoption_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_initiatives_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "adoption_initiatives_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_initiatives_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_initiatives_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      adoption_object_links: {
        Row: {
          adoption_initiative_id: string | null
          adoption_plan_id: string
          created_at: string
          created_by: string | null
          id: string
          object_id: string
          object_type: string
          organization_id: string
          project_id: string
          workspace_id: string
        }
        Insert: {
          adoption_initiative_id?: string | null
          adoption_plan_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          object_id: string
          object_type: string
          organization_id: string
          project_id: string
          workspace_id: string
        }
        Update: {
          adoption_initiative_id?: string | null
          adoption_plan_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          object_id?: string
          object_type?: string
          organization_id?: string
          project_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adoption_object_links_adoption_initiative_id_fkey"
            columns: ["adoption_initiative_id"]
            isOneToOne: false
            referencedRelation: "adoption_initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_object_links_adoption_plan_id_fkey"
            columns: ["adoption_plan_id"]
            isOneToOne: false
            referencedRelation: "adoption_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_object_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "adoption_object_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_object_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_object_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      adoption_plans: {
        Row: {
          adoption_owner_id: string | null
          approach_summary: string | null
          created_at: string
          created_by: string | null
          created_from_template: boolean
          enabled: boolean
          id: string
          impacted_audience_summary: string | null
          is_archived: boolean
          objective: string | null
          organization_id: string
          project_id: string
          readiness_status: Database["public"]["Enums"]["adoption_readiness_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          adoption_owner_id?: string | null
          approach_summary?: string | null
          created_at?: string
          created_by?: string | null
          created_from_template?: boolean
          enabled?: boolean
          id?: string
          impacted_audience_summary?: string | null
          is_archived?: boolean
          objective?: string | null
          organization_id: string
          project_id: string
          readiness_status?: Database["public"]["Enums"]["adoption_readiness_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          adoption_owner_id?: string | null
          approach_summary?: string | null
          created_at?: string
          created_by?: string | null
          created_from_template?: boolean
          enabled?: boolean
          id?: string
          impacted_audience_summary?: string | null
          is_archived?: boolean
          objective?: string | null
          organization_id?: string
          project_id?: string
          readiness_status?: Database["public"]["Enums"]["adoption_readiness_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adoption_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "adoption_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_plans_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      adoption_template_initiatives: {
        Row: {
          adoption_template_id: string
          created_at: string
          default_selected: boolean
          id: string
          is_archived: boolean
          name: string
          organization_id: string
          readiness_area: Database["public"]["Enums"]["adoption_readiness_area"]
          sort_order: number
          summary: string | null
          template_key: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          adoption_template_id: string
          created_at?: string
          default_selected?: boolean
          id?: string
          is_archived?: boolean
          name: string
          organization_id: string
          readiness_area: Database["public"]["Enums"]["adoption_readiness_area"]
          sort_order?: number
          summary?: string | null
          template_key: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          adoption_template_id?: string
          created_at?: string
          default_selected?: boolean
          id?: string
          is_archived?: boolean
          name?: string
          organization_id?: string
          readiness_area?: Database["public"]["Enums"]["adoption_readiness_area"]
          sort_order?: number
          summary?: string | null
          template_key?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adoption_template_initiatives_adoption_template_id_fkey"
            columns: ["adoption_template_id"]
            isOneToOne: false
            referencedRelation: "adoption_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_template_initiatives_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "adoption_template_initiatives_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_template_initiatives_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      adoption_template_tasks: {
        Row: {
          adoption_template_id: string
          adoption_template_initiative_id: string
          created_at: string
          default_selected: boolean
          description: string | null
          id: string
          is_archived: boolean
          is_custom: boolean
          organization_id: string
          sort_order: number
          template_key: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          adoption_template_id: string
          adoption_template_initiative_id: string
          created_at?: string
          default_selected?: boolean
          description?: string | null
          id?: string
          is_archived?: boolean
          is_custom?: boolean
          organization_id: string
          sort_order?: number
          template_key: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          adoption_template_id?: string
          adoption_template_initiative_id?: string
          created_at?: string
          default_selected?: boolean
          description?: string | null
          id?: string
          is_archived?: boolean
          is_custom?: boolean
          organization_id?: string
          sort_order?: number
          template_key?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adoption_template_tasks_adoption_template_id_fkey"
            columns: ["adoption_template_id"]
            isOneToOne: false
            referencedRelation: "adoption_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_template_tasks_adoption_template_initiative_id_fkey"
            columns: ["adoption_template_initiative_id"]
            isOneToOne: false
            referencedRelation: "adoption_template_initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_template_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "adoption_template_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_template_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      adoption_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          is_system: boolean
          name: string
          organization_id: string
          scope: string
          source_template_key: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          is_system?: boolean
          name: string
          organization_id: string
          scope?: string
          source_template_key?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          is_system?: boolean
          name?: string
          organization_id?: string
          scope?: string
          source_template_key?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adoption_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "adoption_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adoption_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_feature_settings: {
        Row: {
          created_at: string
          enabled: boolean
          feature_key: string
          id: string
          max_files_per_request: number | null
          max_individual_file_mb: number | null
          max_total_file_mb: number | null
          model_registry_id: string
          organization_id: string
          provider: string
          reasoning_effort: string | null
          require_user_confirmation: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          feature_key: string
          id?: string
          max_files_per_request?: number | null
          max_individual_file_mb?: number | null
          max_total_file_mb?: number | null
          model_registry_id: string
          organization_id: string
          provider?: string
          reasoning_effort?: string | null
          require_user_confirmation?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          feature_key?: string
          id?: string
          max_files_per_request?: number | null
          max_individual_file_mb?: number | null
          max_total_file_mb?: number | null
          model_registry_id?: string
          organization_id?: string
          provider?: string
          reasoning_effort?: string | null
          require_user_confirmation?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_feature_settings_model_registry_id_fkey"
            columns: ["model_registry_id"]
            isOneToOne: false
            referencedRelation: "ai_model_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_feature_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "ai_feature_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_guide_v2_embedding_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_summary: string | null
          id: string
          job_type: string
          organization_id: string
          requested_by: string | null
          source_article_id: string | null
          source_slug: string | null
          started_at: string | null
          stats: Json
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_summary?: string | null
          id?: string
          job_type: string
          organization_id: string
          requested_by?: string | null
          source_article_id?: string | null
          source_slug?: string | null
          started_at?: string | null
          stats?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_summary?: string | null
          id?: string
          job_type?: string
          organization_id?: string
          requested_by?: string | null
          source_article_id?: string | null
          source_slug?: string | null
          started_at?: string | null
          stats?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_guide_v2_knowledge_chunks: {
        Row: {
          article_id: string | null
          article_slug: string | null
          article_title: string | null
          audience: string[] | null
          chunk_index: number
          chunk_key: string
          chunk_text_preview: string | null
          chunk_text_protected: string | null
          content_hash: string
          created_at: string
          embedding: string
          embedding_dimensions: number
          embedding_model: string
          feature_area: string[] | null
          freshness_label: string | null
          id: string
          indexed_at: string | null
          metadata: Json
          organization_id: string
          route_patterns: string[] | null
          source_id: string
          source_status: string
          source_type: string
          source_updated_at: string | null
          updated_at: string
          user_intents: string[] | null
          vector_ready: boolean
          visibility_scope: Json
          workflow_id: string | null
          workflow_status: string | null
        }
        Insert: {
          article_id?: string | null
          article_slug?: string | null
          article_title?: string | null
          audience?: string[] | null
          chunk_index?: number
          chunk_key: string
          chunk_text_preview?: string | null
          chunk_text_protected?: string | null
          content_hash: string
          created_at?: string
          embedding: string
          embedding_dimensions?: number
          embedding_model: string
          feature_area?: string[] | null
          freshness_label?: string | null
          id?: string
          indexed_at?: string | null
          metadata?: Json
          organization_id: string
          route_patterns?: string[] | null
          source_id: string
          source_status: string
          source_type: string
          source_updated_at?: string | null
          updated_at?: string
          user_intents?: string[] | null
          vector_ready?: boolean
          visibility_scope?: Json
          workflow_id?: string | null
          workflow_status?: string | null
        }
        Update: {
          article_id?: string | null
          article_slug?: string | null
          article_title?: string | null
          audience?: string[] | null
          chunk_index?: number
          chunk_key?: string
          chunk_text_preview?: string | null
          chunk_text_protected?: string | null
          content_hash?: string
          created_at?: string
          embedding?: string
          embedding_dimensions?: number
          embedding_model?: string
          feature_area?: string[] | null
          freshness_label?: string | null
          id?: string
          indexed_at?: string | null
          metadata?: Json
          organization_id?: string
          route_patterns?: string[] | null
          source_id?: string
          source_status?: string
          source_type?: string
          source_updated_at?: string | null
          updated_at?: string
          user_intents?: string[] | null
          vector_ready?: boolean
          visibility_scope?: Json
          workflow_id?: string | null
          workflow_status?: string | null
        }
        Relationships: []
      }
      ai_help_conversations: {
        Row: {
          archived_at: string | null
          context_label: string | null
          context_route: string | null
          created_at: string
          id: string
          organization_id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          context_label?: string | null
          context_route?: string | null
          created_at?: string
          id?: string
          organization_id: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          context_label?: string | null
          context_route?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_help_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "ai_help_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_help_message_feedback: {
        Row: {
          assistant_message_id: string
          comment: string | null
          conversation_id: string
          created_at: string
          id: string
          organization_id: string
          rating: string
          reason_code: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assistant_message_id: string
          comment?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          organization_id: string
          rating: string
          reason_code?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assistant_message_id?: string
          comment?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          rating?: string
          reason_code?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_help_message_feedback_assistant_message_id_fkey"
            columns: ["assistant_message_id"]
            isOneToOne: false
            referencedRelation: "ai_help_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_help_message_feedback_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_help_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_help_message_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "ai_help_message_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_help_messages: {
        Row: {
          content: string
          context_label: string | null
          context_route: string | null
          conversation_id: string
          created_at: string
          id: string
          organization_id: string
          role: string
          source_article_ids: string[]
          user_id: string
        }
        Insert: {
          content: string
          context_label?: string | null
          context_route?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          organization_id: string
          role: string
          source_article_ids?: string[]
          user_id: string
        }
        Update: {
          content?: string
          context_label?: string | null
          context_route?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          source_article_ids?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_help_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_help_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_help_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "ai_help_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_instruction_templates: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          created_by: string | null
          feature_key: string
          id: string
          instruction_text: string
          notes: string | null
          organization_id: string
          status: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          created_by?: string | null
          feature_key: string
          id?: string
          instruction_text: string
          notes?: string | null
          organization_id: string
          status?: string
          title: string
          updated_at?: string
          version: number
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          created_by?: string | null
          feature_key?: string
          id?: string
          instruction_text?: string
          notes?: string | null
          organization_id?: string
          status?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_instruction_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "ai_instruction_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_model_registry: {
        Row: {
          active: boolean
          capability_tier: string
          created_at: string
          display_name: string
          id: string
          model_id: string
          provider: string
          recommended_for_decision_cases: boolean
          recommended_for_guide: boolean
          recommended_for_roadmap_story: boolean
          sort_order: number
          supports_file_input: boolean
          supports_structured_output: boolean
          supports_vision: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          capability_tier: string
          created_at?: string
          display_name: string
          id?: string
          model_id: string
          provider: string
          recommended_for_decision_cases?: boolean
          recommended_for_guide?: boolean
          recommended_for_roadmap_story?: boolean
          sort_order?: number
          supports_file_input?: boolean
          supports_structured_output?: boolean
          supports_vision?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          capability_tier?: string
          created_at?: string
          display_name?: string
          id?: string
          model_id?: string
          provider?: string
          recommended_for_decision_cases?: boolean
          recommended_for_guide?: boolean
          recommended_for_roadmap_story?: boolean
          sort_order?: number
          supports_file_input?: boolean
          supports_structured_output?: boolean
          supports_vision?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      api_capability_catalogue: {
        Row: {
          administrator_assignable: boolean
          api_version: string
          capability_key: string
          capability_kind: string
          created_at: string
          description: string
          display_name: string
          http_method: string
          lifecycle_status: string
          route_id: string
          route_path: string
          scope_level: string
          updated_at: string
        }
        Insert: {
          administrator_assignable?: boolean
          api_version: string
          capability_key: string
          capability_kind: string
          created_at?: string
          description: string
          display_name: string
          http_method: string
          lifecycle_status?: string
          route_id: string
          route_path: string
          scope_level: string
          updated_at?: string
        }
        Update: {
          administrator_assignable?: boolean
          api_version?: string
          capability_key?: string
          capability_kind?: string
          created_at?: string
          description?: string
          display_name?: string
          http_method?: string
          lifecycle_status?: string
          route_id?: string
          route_path?: string
          scope_level?: string
          updated_at?: string
        }
        Relationships: []
      }
      api_capability_grants: {
        Row: {
          api_client_id: string
          api_version: string
          capability_key: string
          capability_kind: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          enabled_at: string | null
          id: string
          lifecycle_status: string
          organization_id: string
          reason: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string | null
        }
        Insert: {
          api_client_id: string
          api_version?: string
          capability_key: string
          capability_kind: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          enabled_at?: string | null
          id?: string
          lifecycle_status?: string
          organization_id: string
          reason?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string | null
        }
        Update: {
          api_client_id?: string
          api_version?: string
          capability_key?: string
          capability_kind?: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          enabled_at?: string | null
          id?: string
          lifecycle_status?: string
          organization_id?: string
          reason?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_capability_grants_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_capability_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "api_capability_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_capability_grants_supported_capability_fk"
            columns: [
              "api_client_id",
              "api_version",
              "capability_kind",
              "capability_key",
            ]
            isOneToOne: false
            referencedRelation: "api_client_supported_capabilities"
            referencedColumns: [
              "api_client_id",
              "api_version",
              "capability_kind",
              "capability_key",
            ]
          },
          {
            foreignKeyName: "api_capability_grants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "api_capability_grants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_capability_grants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      api_client_oauth_redirect_uris: {
        Row: {
          api_client_id: string
          created_at: string
          created_by: string | null
          id: string
          lifecycle_status: string
          redirect_uri: string
          retired_at: string | null
          updated_at: string
          updated_by: string | null
          verified_at: string | null
        }
        Insert: {
          api_client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          lifecycle_status?: string
          redirect_uri: string
          retired_at?: string | null
          updated_at?: string
          updated_by?: string | null
          verified_at?: string | null
        }
        Update: {
          api_client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lifecycle_status?: string
          redirect_uri?: string
          retired_at?: string | null
          updated_at?: string
          updated_by?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_client_oauth_redirect_uris_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      api_client_policy_versions: {
        Row: {
          api_client_id: string
          created_at: string
          created_by: string | null
          effective_at: string | null
          id: string
          lifecycle_status: string
          policy_digest: string
          policy_uri: string
          retired_at: string | null
          updated_at: string
          updated_by: string | null
          version: string
        }
        Insert: {
          api_client_id: string
          created_at?: string
          created_by?: string | null
          effective_at?: string | null
          id?: string
          lifecycle_status?: string
          policy_digest: string
          policy_uri: string
          retired_at?: string | null
          updated_at?: string
          updated_by?: string | null
          version: string
        }
        Update: {
          api_client_id?: string
          created_at?: string
          created_by?: string | null
          effective_at?: string | null
          id?: string
          lifecycle_status?: string
          policy_digest?: string
          policy_uri?: string
          retired_at?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_client_policy_versions_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      api_client_supported_capabilities: {
        Row: {
          api_client_id: string
          api_version: string
          capability_key: string
          capability_kind: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          enabled_at: string | null
          id: string
          lifecycle_status: string
          reason: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          api_client_id: string
          api_version: string
          capability_key: string
          capability_kind: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          enabled_at?: string | null
          id?: string
          lifecycle_status?: string
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          api_client_id?: string
          api_version?: string
          capability_key?: string
          capability_kind?: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          enabled_at?: string | null
          id?: string
          lifecycle_status?: string
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_client_supported_capabilities_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_client_supported_capabilities_catalogue_fk"
            columns: ["api_version", "capability_kind", "capability_key"]
            isOneToOne: false
            referencedRelation: "api_capability_catalogue"
            referencedColumns: [
              "api_version",
              "capability_kind",
              "capability_key",
            ]
          },
        ]
      }
      api_clients: {
        Row: {
          client_key: string
          created_at: string
          created_by: string | null
          description: string | null
          display_name: string
          id: string
          lifecycle_status: string
          oauth_client_id: string | null
          oauth_resource_audience: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_key: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name: string
          id?: string
          lifecycle_status?: string
          oauth_client_id?: string | null
          oauth_resource_audience?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_key?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name?: string
          id?: string
          lifecycle_status?: string
          oauth_client_id?: string | null
          oauth_resource_audience?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      api_connected_apps_admin_audit_events: {
        Row: {
          action: string
          actor_user_id: string
          api_client_id: string
          correlation_id: string
          event_at: string
          id: string
          organization_id: string
          previous_lifecycle_status: string | null
          resulting_lifecycle_status: string
          source_channel: string
          target_id: string
          target_type: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_user_id: string
          api_client_id: string
          correlation_id: string
          event_at?: string
          id?: string
          organization_id: string
          previous_lifecycle_status?: string | null
          resulting_lifecycle_status: string
          source_channel: string
          target_id: string
          target_type: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          api_client_id?: string
          correlation_id?: string
          event_at?: string
          id?: string
          organization_id?: string
          previous_lifecycle_status?: string | null
          resulting_lifecycle_status?: string
          source_channel?: string
          target_id?: string
          target_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_connected_apps_admin_audit_events_client_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_connected_apps_admin_audit_events_org_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "api_connected_apps_admin_audit_events_org_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_connected_apps_admin_audit_events_tenant_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "api_connected_apps_admin_audit_events_tenant_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      api_consent_audit_events: {
        Row: {
          action: string
          actor_user_id: string
          api_client_id: string
          correlation_id: string | null
          event_at: string
          id: string
          metadata: Json
          policy_version_id: string
          source_channel: string
        }
        Insert: {
          action: string
          actor_user_id: string
          api_client_id: string
          correlation_id?: string | null
          event_at?: string
          id?: string
          metadata?: Json
          policy_version_id: string
          source_channel?: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          api_client_id?: string
          correlation_id?: string | null
          event_at?: string
          id?: string
          metadata?: Json
          policy_version_id?: string
          source_channel?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_consent_audit_events_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_consent_audit_events_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "api_client_policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      api_idempotency_registry: {
        Row: {
          canonical_result: Json | null
          command: string
          completed_at: string | null
          created_at: string
          failure_code: string | null
          id: string
          idempotency_key: string
          payload_hash: string
          requested_user_id: string
          source_client_id: string
          state: string
          updated_at: string
        }
        Insert: {
          canonical_result?: Json | null
          command: string
          completed_at?: string | null
          created_at?: string
          failure_code?: string | null
          id?: string
          idempotency_key: string
          payload_hash: string
          requested_user_id: string
          source_client_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          canonical_result?: Json | null
          command?: string
          completed_at?: string | null
          created_at?: string
          failure_code?: string | null
          id?: string
          idempotency_key?: string
          payload_hash?: string
          requested_user_id?: string
          source_client_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_idempotency_registry_requested_user_id_fkey"
            columns: ["requested_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_idempotency_registry_source_client_id_fkey"
            columns: ["source_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      api_organization_client_enablements: {
        Row: {
          api_client_id: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          enabled_at: string | null
          id: string
          lifecycle_status: string
          organization_id: string
          reason: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          api_client_id: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          enabled_at?: string | null
          id?: string
          lifecycle_status?: string
          organization_id: string
          reason?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          api_client_id?: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          enabled_at?: string | null
          id?: string
          lifecycle_status?: string
          organization_id?: string
          reason?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_organization_client_enablements_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_organization_client_enablements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "api_organization_client_enablements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_organization_client_enablements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "api_organization_client_enablements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      api_organization_client_rate_profile_assignments: {
        Row: {
          api_client_id: string
          assigned_by: string
          created_at: string
          id: string
          organization_id: string
          rate_profile_id: string
          updated_at: string
        }
        Insert: {
          api_client_id: string
          assigned_by: string
          created_at?: string
          id?: string
          organization_id: string
          rate_profile_id: string
          updated_at?: string
        }
        Update: {
          api_client_id?: string
          assigned_by?: string
          created_at?: string
          id?: string
          organization_id?: string
          rate_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_organization_client_rate_profile_assig_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "api_organization_client_rate_profile_assig_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_organization_client_rate_profile_assig_rate_profile_id_fkey"
            columns: ["rate_profile_id"]
            isOneToOne: false
            referencedRelation: "api_rate_limit_profile_catalogue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_organization_client_rate_profile_assignm_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      api_platform_admin_audit_events: {
        Row: {
          action: string
          actor_user_id: string
          api_client_id: string
          correlation_id: string
          event_at: string
          id: string
          previous_lifecycle_status: string | null
          previous_protected_resource: string | null
          resulting_lifecycle_status: string
          resulting_protected_resource: string | null
          source_channel: string
          target_id: string
          target_type: string
        }
        Insert: {
          action: string
          actor_user_id: string
          api_client_id: string
          correlation_id?: string
          event_at?: string
          id?: string
          previous_lifecycle_status?: string | null
          previous_protected_resource?: string | null
          resulting_lifecycle_status: string
          resulting_protected_resource?: string | null
          source_channel?: string
          target_id: string
          target_type: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          api_client_id?: string
          correlation_id?: string
          event_at?: string
          id?: string
          previous_lifecycle_status?: string | null
          previous_protected_resource?: string | null
          resulting_lifecycle_status?: string
          resulting_protected_resource?: string | null
          source_channel?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_platform_admin_audit_events_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      api_project_client_enablements: {
        Row: {
          api_client_id: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          enabled_at: string | null
          id: string
          lifecycle_status: string
          organization_id: string
          project_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          api_client_id: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          enabled_at?: string | null
          id?: string
          lifecycle_status?: string
          organization_id: string
          project_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          api_client_id?: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          enabled_at?: string | null
          id?: string
          lifecycle_status?: string
          organization_id?: string
          project_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_project_client_enablements_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_project_client_enablements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "api_project_client_enablements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_project_client_enablements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_project_client_enablements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "api_project_client_enablements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_project_client_enablements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      api_rate_limit_buckets: {
        Row: {
          api_client_id: string
          request_count: number
          route_id: string
          updated_at: string
          user_id: string
          window_seconds: number
          window_started_at: string
        }
        Insert: {
          api_client_id: string
          request_count: number
          route_id: string
          updated_at?: string
          user_id: string
          window_seconds: number
          window_started_at: string
        }
        Update: {
          api_client_id?: string
          request_count?: number
          route_id?: string
          updated_at?: string
          user_id?: string
          window_seconds?: number
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_rate_limit_buckets_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_rate_limit_buckets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      api_rate_limit_profile_catalogue: {
        Row: {
          created_at: string
          description: string
          display_name: string
          id: string
          is_default: boolean
          lifecycle_status: string
          profile_key: string
          request_limit: number
          updated_at: string
          window_seconds: number
        }
        Insert: {
          created_at?: string
          description: string
          display_name: string
          id?: string
          is_default?: boolean
          lifecycle_status?: string
          profile_key: string
          request_limit: number
          updated_at?: string
          window_seconds: number
        }
        Update: {
          created_at?: string
          description?: string
          display_name?: string
          id?: string
          is_default?: boolean
          lifecycle_status?: string
          profile_key?: string
          request_limit?: number
          updated_at?: string
          window_seconds?: number
        }
        Relationships: []
      }
      api_rate_limit_profiles: {
        Row: {
          api_client_id: string
          created_at: string
          id: string
          lifecycle_status: string
          request_limit: number
          route_id: string
          updated_at: string
          window_seconds: number
        }
        Insert: {
          api_client_id: string
          created_at?: string
          id?: string
          lifecycle_status?: string
          request_limit: number
          route_id: string
          updated_at?: string
          window_seconds: number
        }
        Update: {
          api_client_id?: string
          created_at?: string
          id?: string
          lifecycle_status?: string
          request_limit?: number
          route_id?: string
          updated_at?: string
          window_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "api_rate_limit_profiles_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      api_request_activity_events: {
        Row: {
          actor_user_id: string | null
          api_client_id: string
          api_version: string
          correlation_id: string | null
          duration_ms: number
          event_at: string
          http_method: string
          http_status: number
          id: string
          organization_id: string | null
          project_id: string | null
          route_id: string
          source_channel: string
          tenant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          api_client_id: string
          api_version: string
          correlation_id?: string | null
          duration_ms: number
          event_at?: string
          http_method: string
          http_status: number
          id?: string
          organization_id?: string | null
          project_id?: string | null
          route_id: string
          source_channel?: string
          tenant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          api_client_id?: string
          api_version?: string
          correlation_id?: string | null
          duration_ms?: number
          event_at?: string
          http_method?: string
          http_status?: number
          id?: string
          organization_id?: string | null
          project_id?: string | null
          route_id?: string
          source_channel?: string
          tenant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_request_activity_events_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_request_activity_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "api_request_activity_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_request_activity_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_request_activity_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "api_request_activity_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_request_activity_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      api_user_policy_acknowledgements: {
        Row: {
          ack_metadata: Json
          acknowledged_at: string
          api_client_id: string
          created_at: string
          id: string
          policy_version_id: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          ack_metadata?: Json
          acknowledged_at?: string
          api_client_id: string
          created_at?: string
          id?: string
          policy_version_id: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          ack_metadata?: Json
          acknowledged_at?: string
          api_client_id?: string
          created_at?: string
          id?: string
          policy_version_id?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_user_policy_acknowledgements_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_user_policy_acknowledgements_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "api_client_policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      api_workspace_client_enablements: {
        Row: {
          api_client_id: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          enabled_at: string | null
          id: string
          lifecycle_status: string
          organization_id: string
          reason: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          api_client_id: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          enabled_at?: string | null
          id?: string
          lifecycle_status?: string
          organization_id: string
          reason?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          api_client_id?: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          enabled_at?: string | null
          id?: string
          lifecycle_status?: string
          organization_id?: string
          reason?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_workspace_client_enablements_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_workspace_client_enablements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "api_workspace_client_enablements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_workspace_client_enablements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "api_workspace_client_enablements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_workspace_client_enablements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      backlog_items: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          organization_id: string
          phase_id: string | null
          priority: Database["public"]["Enums"]["pm_priority"]
          project_id: string
          sort_order: number
          sprint_id: string | null
          title: string
          updated_at: string
          workflow_state_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          organization_id: string
          phase_id?: string | null
          priority?: Database["public"]["Enums"]["pm_priority"]
          project_id: string
          sort_order?: number
          sprint_id?: string | null
          title: string
          updated_at?: string
          workflow_state_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          organization_id?: string
          phase_id?: string | null
          priority?: Database["public"]["Enums"]["pm_priority"]
          project_id?: string
          sort_order?: number
          sprint_id?: string | null
          title?: string
          updated_at?: string
          workflow_state_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "backlog_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "backlog_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backlog_items_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backlog_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backlog_items_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backlog_items_workflow_state_id_fkey"
            columns: ["workflow_state_id"]
            isOneToOne: false
            referencedRelation: "board_workflow_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backlog_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      blockers: {
        Row: {
          created_at: string
          description: string | null
          id: string
          organization_id: string
          reported_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["pm_priority"]
          status: Database["public"]["Enums"]["blocker_status"]
          target_id: string
          target_type: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          organization_id: string
          reported_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["pm_priority"]
          status?: Database["public"]["Enums"]["blocker_status"]
          target_id: string
          target_type: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string
          reported_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["pm_priority"]
          status?: Database["public"]["Enums"]["blocker_status"]
          target_id?: string
          target_type?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blockers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "blockers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blockers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      board_workflow_states: {
        Row: {
          category: Database["public"]["Enums"]["workflow_state_category"]
          created_at: string
          created_by: string | null
          id: string
          is_archived: boolean
          name: string
          organization_id: string
          project_id: string
          sort_order: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category: Database["public"]["Enums"]["workflow_state_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          is_archived?: boolean
          name: string
          organization_id: string
          project_id: string
          sort_order?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["workflow_state_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          organization_id?: string
          project_id?: string
          sort_order?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_workflow_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "board_workflow_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_workflow_states_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_workflow_states_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      btpm_import_batches: {
        Row: {
          committed_at: string | null
          counts_json: Json
          created_at: string
          dry_run_at: string | null
          id: string
          import_type: string
          organization_id: string
          payload_hash: string
          requested_by: string
          safe_issue_summary_json: Json
          safe_summary_json: Json
          schema_version: string
          source_file_name: string | null
          source_name: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          committed_at?: string | null
          counts_json?: Json
          created_at?: string
          dry_run_at?: string | null
          id?: string
          import_type: string
          organization_id: string
          payload_hash: string
          requested_by: string
          safe_issue_summary_json?: Json
          safe_summary_json?: Json
          schema_version: string
          source_file_name?: string | null
          source_name?: string | null
          status: string
          workspace_id: string
        }
        Update: {
          committed_at?: string | null
          counts_json?: Json
          created_at?: string
          dry_run_at?: string | null
          id?: string
          import_type?: string
          organization_id?: string
          payload_hash?: string
          requested_by?: string
          safe_issue_summary_json?: Json
          safe_summary_json?: Json
          schema_version?: string
          source_file_name?: string | null
          source_name?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "btpm_import_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "btpm_import_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "btpm_import_batches_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          is_edited: boolean
          organization_id: string
          target_id: string
          target_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          is_edited?: boolean
          organization_id: string
          target_id: string
          target_type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          is_edited?: boolean
          organization_id?: string
          target_id?: string
          target_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_case_ai_run_files: {
        Row: {
          ai_run_id: string
          attachment_alias: string | null
          created_at: string
          error_code: string | null
          evidence_file_id: string | null
          file_extension: string | null
          governance_record_id: string
          id: string
          input_kind: string | null
          mime_type: string | null
          organization_id: string
          project_id: string
          sha256: string | null
          size_bytes: number | null
          skip_reason: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          ai_run_id: string
          attachment_alias?: string | null
          created_at?: string
          error_code?: string | null
          evidence_file_id?: string | null
          file_extension?: string | null
          governance_record_id: string
          id?: string
          input_kind?: string | null
          mime_type?: string | null
          organization_id: string
          project_id: string
          sha256?: string | null
          size_bytes?: number | null
          skip_reason?: string | null
          status: string
          workspace_id: string
        }
        Update: {
          ai_run_id?: string
          attachment_alias?: string | null
          created_at?: string
          error_code?: string | null
          evidence_file_id?: string | null
          file_extension?: string | null
          governance_record_id?: string
          id?: string
          input_kind?: string | null
          mime_type?: string | null
          organization_id?: string
          project_id?: string
          sha256?: string | null
          size_bytes?: number | null
          skip_reason?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_case_ai_run_files_ai_run_id_fkey"
            columns: ["ai_run_id"]
            isOneToOne: false
            referencedRelation: "decision_case_ai_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_case_ai_run_files_evidence_file_id_fkey"
            columns: ["evidence_file_id"]
            isOneToOne: false
            referencedRelation: "governance_record_evidence_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_case_ai_run_files_governance_record_id_fkey"
            columns: ["governance_record_id"]
            isOneToOne: false
            referencedRelation: "governance_records"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_case_ai_runs: {
        Row: {
          brief_version_id: string | null
          completed_at: string | null
          created_at: string
          discarded_at: string | null
          error_code: string | null
          error_message: string | null
          files_selected_count: number
          files_sent_count: number
          files_skipped_count: number
          governance_record_id: string
          id: string
          input_package_hash: string | null
          model_id: string
          model_provider: string
          model_source: string
          openai_response_id: string | null
          organization_id: string
          output_hash: string | null
          project_id: string
          reasoning_effort: string | null
          run_type: string
          saved_at: string | null
          started_at: string
          started_by: string
          status: string
          template_feature_key: string
          template_id: string | null
          template_version: number | null
          total_bytes_sent: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          brief_version_id?: string | null
          completed_at?: string | null
          created_at?: string
          discarded_at?: string | null
          error_code?: string | null
          error_message?: string | null
          files_selected_count?: number
          files_sent_count?: number
          files_skipped_count?: number
          governance_record_id: string
          id?: string
          input_package_hash?: string | null
          model_id: string
          model_provider?: string
          model_source?: string
          openai_response_id?: string | null
          organization_id: string
          output_hash?: string | null
          project_id: string
          reasoning_effort?: string | null
          run_type?: string
          saved_at?: string | null
          started_at?: string
          started_by: string
          status: string
          template_feature_key?: string
          template_id?: string | null
          template_version?: number | null
          total_bytes_sent?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          brief_version_id?: string | null
          completed_at?: string | null
          created_at?: string
          discarded_at?: string | null
          error_code?: string | null
          error_message?: string | null
          files_selected_count?: number
          files_sent_count?: number
          files_skipped_count?: number
          governance_record_id?: string
          id?: string
          input_package_hash?: string | null
          model_id?: string
          model_provider?: string
          model_source?: string
          openai_response_id?: string | null
          organization_id?: string
          output_hash?: string | null
          project_id?: string
          reasoning_effort?: string | null
          run_type?: string
          saved_at?: string | null
          started_at?: string
          started_by?: string
          status?: string
          template_feature_key?: string
          template_id?: string | null
          template_version?: number | null
          total_bytes_sent?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_case_ai_runs_brief_version_id_fkey"
            columns: ["brief_version_id"]
            isOneToOne: false
            referencedRelation: "governance_record_brief_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_case_ai_runs_governance_record_id_fkey"
            columns: ["governance_record_id"]
            isOneToOne: false
            referencedRelation: "governance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_case_ai_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "ai_instruction_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      dependencies: {
        Row: {
          created_at: string
          created_by: string | null
          dependency_type: Database["public"]["Enums"]["dependency_type"]
          description: string | null
          id: string
          organization_id: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dependency_type?: Database["public"]["Enums"]["dependency_type"]
          description?: string | null
          id?: string
          organization_id: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dependency_type?: Database["public"]["Enums"]["dependency_type"]
          description?: string | null
          id?: string
          organization_id?: string
          source_id?: string
          source_type?: string
          target_id?: string
          target_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dependencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "dependencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dependencies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_payload_snapshots: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          payload: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          payload: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          payload?: string
          target_id?: string
          target_type?: string
          workspace_id?: string
        }
        Relationships: []
      }
      entity_object_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          link_role: string
          organization_id: string
          owner_id: string
          owner_type: string
          referenced_id: string
          referenced_type: string
          sort_order: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          link_role: string
          organization_id: string
          owner_id: string
          owner_type: string
          referenced_id: string
          referenced_type: string
          sort_order?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          link_role?: string
          organization_id?: string
          owner_id?: string
          owner_type?: string
          referenced_id?: string
          referenced_type?: string
          sort_order?: number
          workspace_id?: string
        }
        Relationships: []
      }
      entity_user_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          link_role: string
          organization_id: string
          owner_id: string
          owner_type: string
          sort_order: number
          stakeholder_id: string | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          link_role: string
          organization_id: string
          owner_id: string
          owner_type: string
          sort_order?: number
          stakeholder_id?: string | null
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          link_role?: string
          organization_id?: string
          owner_id?: string
          owner_type?: string
          sort_order?: number
          stakeholder_id?: string | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_user_links_stakeholder_id_fkey"
            columns: ["stakeholder_id"]
            isOneToOne: false
            referencedRelation: "project_stakeholders"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_updates: {
        Row: {
          author_id: string
          created_at: string
          id: string
          organization_id: string
          status_label: string | null
          summary: string
          target_id: string
          target_type: string
          update_date: string
          workspace_id: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          organization_id: string
          status_label?: string | null
          summary: string
          target_id: string
          target_type: string
          update_date?: string
          workspace_id: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          status_label?: string | null
          summary?: string
          target_id?: string
          target_type?: string
          update_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_updates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "execution_updates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_updates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_operational_documents: {
        Row: {
          created_at: string
          document_type: Database["public"]["Enums"]["generated_doc_type"]
          error_note: string | null
          generated_at: string
          generated_by: string | null
          generation_status: Database["public"]["Enums"]["generated_doc_status"]
          governance_record_id: string | null
          id: string
          organization_id: string
          output_filename: string
          project_id: string | null
          sharepoint_item_id: string | null
          sharepoint_publish_status:
            | Database["public"]["Enums"]["generated_doc_publish_status"]
            | null
          sharepoint_web_url: string | null
          source_snapshot_at: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          document_type: Database["public"]["Enums"]["generated_doc_type"]
          error_note?: string | null
          generated_at?: string
          generated_by?: string | null
          generation_status: Database["public"]["Enums"]["generated_doc_status"]
          governance_record_id?: string | null
          id?: string
          organization_id: string
          output_filename: string
          project_id?: string | null
          sharepoint_item_id?: string | null
          sharepoint_publish_status?:
            | Database["public"]["Enums"]["generated_doc_publish_status"]
            | null
          sharepoint_web_url?: string | null
          source_snapshot_at?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          document_type?: Database["public"]["Enums"]["generated_doc_type"]
          error_note?: string | null
          generated_at?: string
          generated_by?: string | null
          generation_status?: Database["public"]["Enums"]["generated_doc_status"]
          governance_record_id?: string | null
          id?: string
          organization_id?: string
          output_filename?: string
          project_id?: string | null
          sharepoint_item_id?: string | null
          sharepoint_publish_status?:
            | Database["public"]["Enums"]["generated_doc_publish_status"]
            | null
          sharepoint_web_url?: string | null
          source_snapshot_at?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_operational_documents_governance_record_id_fkey"
            columns: ["governance_record_id"]
            isOneToOne: false
            referencedRelation: "governance_records"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_cadences: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          event_name: string | null
          event_type: string
          expected_evidence_type: string | null
          frequency_type: string
          id: string
          next_expected_date: string | null
          organization_id: string
          owner_id: string | null
          owner_stakeholder_id: string | null
          project_id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          event_name?: string | null
          event_type: string
          expected_evidence_type?: string | null
          frequency_type: string
          id?: string
          next_expected_date?: string | null
          organization_id: string
          owner_id?: string | null
          owner_stakeholder_id?: string | null
          project_id: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          event_name?: string | null
          event_type?: string
          expected_evidence_type?: string | null
          frequency_type?: string
          id?: string
          next_expected_date?: string | null
          organization_id?: string
          owner_id?: string | null
          owner_stakeholder_id?: string | null
          project_id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_cadences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "governance_cadences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_cadences_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_cadences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_cadences_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_record_brief_versions: {
        Row: {
          confidence_level: string | null
          created_at: string
          created_by: string | null
          decision_readiness: string | null
          edited_brief_text: string | null
          executive_intro_text: string | null
          governance_record_id: string
          guardrails_text: string | null
          id: string
          is_current: boolean
          open_questions_text: string | null
          options_summary: string | null
          organization_id: string
          project_id: string
          raw_copilot_output: string | null
          recommendation_text: string | null
          requested_decision_text: string | null
          residual_risks_text: string | null
          source_type: string
          updated_at: string
          updated_by: string | null
          version_number: number
          workspace_id: string
        }
        Insert: {
          confidence_level?: string | null
          created_at?: string
          created_by?: string | null
          decision_readiness?: string | null
          edited_brief_text?: string | null
          executive_intro_text?: string | null
          governance_record_id: string
          guardrails_text?: string | null
          id?: string
          is_current?: boolean
          open_questions_text?: string | null
          options_summary?: string | null
          organization_id: string
          project_id: string
          raw_copilot_output?: string | null
          recommendation_text?: string | null
          requested_decision_text?: string | null
          residual_risks_text?: string | null
          source_type?: string
          updated_at?: string
          updated_by?: string | null
          version_number: number
          workspace_id: string
        }
        Update: {
          confidence_level?: string | null
          created_at?: string
          created_by?: string | null
          decision_readiness?: string | null
          edited_brief_text?: string | null
          executive_intro_text?: string | null
          governance_record_id?: string
          guardrails_text?: string | null
          id?: string
          is_current?: boolean
          open_questions_text?: string | null
          options_summary?: string | null
          organization_id?: string
          project_id?: string
          raw_copilot_output?: string | null
          recommendation_text?: string | null
          requested_decision_text?: string | null
          residual_risks_text?: string | null
          source_type?: string
          updated_at?: string
          updated_by?: string | null
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_record_brief_versions_governance_record_id_fkey"
            columns: ["governance_record_id"]
            isOneToOne: false
            referencedRelation: "governance_records"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_record_btpm_context_links: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          context_reason: string | null
          created_at: string
          created_by: string | null
          governance_record_id: string
          id: string
          included_in_package: boolean
          object_id: string
          object_type: string
          organization_id: string
          project_id: string
          relationship_type: string
          relevance_level: string
          source_project_id: string
          source_workspace_id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          context_reason?: string | null
          created_at?: string
          created_by?: string | null
          governance_record_id: string
          id?: string
          included_in_package?: boolean
          object_id: string
          object_type: string
          organization_id: string
          project_id: string
          relationship_type?: string
          relevance_level?: string
          source_project_id: string
          source_workspace_id: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          context_reason?: string | null
          created_at?: string
          created_by?: string | null
          governance_record_id?: string
          id?: string
          included_in_package?: boolean
          object_id?: string
          object_type?: string
          organization_id?: string
          project_id?: string
          relationship_type?: string
          relevance_level?: string
          source_project_id?: string
          source_workspace_id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_record_btpm_context_links_governance_record_id_fkey"
            columns: ["governance_record_id"]
            isOneToOne: false
            referencedRelation: "governance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_btpm_context_links_source_project_id_fkey"
            columns: ["source_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_btpm_context_links_source_workspace_id_fkey"
            columns: ["source_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_record_copilot_data_packages: {
        Row: {
          bundle_downloaded_at: string | null
          bundle_downloaded_by: string | null
          bundle_failed_file_count: number | null
          bundle_file_count: number | null
          bundle_filename: string | null
          bundle_generated_at: string | null
          bundle_hash: string | null
          bundle_metadata_only_count: number | null
          bundle_mime_type: string | null
          bundle_packaged_file_count: number | null
          bundle_size_bytes: number | null
          bundle_status: string
          bundle_storage_bucket: string | null
          bundle_storage_path: string | null
          created_at: string
          created_by: string | null
          downloaded_at: string | null
          downloaded_by: string | null
          governance_record_id: string
          id: string
          is_current: boolean
          organization_id: string
          package_filename: string
          package_format: string
          package_hash: string | null
          package_json: string
          package_status: string
          project_id: string
          source_project_ids: string[]
          source_snapshot_at: string
          version_number: number
          workspace_id: string
        }
        Insert: {
          bundle_downloaded_at?: string | null
          bundle_downloaded_by?: string | null
          bundle_failed_file_count?: number | null
          bundle_file_count?: number | null
          bundle_filename?: string | null
          bundle_generated_at?: string | null
          bundle_hash?: string | null
          bundle_metadata_only_count?: number | null
          bundle_mime_type?: string | null
          bundle_packaged_file_count?: number | null
          bundle_size_bytes?: number | null
          bundle_status?: string
          bundle_storage_bucket?: string | null
          bundle_storage_path?: string | null
          created_at?: string
          created_by?: string | null
          downloaded_at?: string | null
          downloaded_by?: string | null
          governance_record_id: string
          id?: string
          is_current?: boolean
          organization_id: string
          package_filename: string
          package_format?: string
          package_hash?: string | null
          package_json: string
          package_status?: string
          project_id: string
          source_project_ids?: string[]
          source_snapshot_at?: string
          version_number: number
          workspace_id: string
        }
        Update: {
          bundle_downloaded_at?: string | null
          bundle_downloaded_by?: string | null
          bundle_failed_file_count?: number | null
          bundle_file_count?: number | null
          bundle_filename?: string | null
          bundle_generated_at?: string | null
          bundle_hash?: string | null
          bundle_metadata_only_count?: number | null
          bundle_mime_type?: string | null
          bundle_packaged_file_count?: number | null
          bundle_size_bytes?: number | null
          bundle_status?: string
          bundle_storage_bucket?: string | null
          bundle_storage_path?: string | null
          created_at?: string
          created_by?: string | null
          downloaded_at?: string | null
          downloaded_by?: string | null
          governance_record_id?: string
          id?: string
          is_current?: boolean
          organization_id?: string
          package_filename?: string
          package_format?: string
          package_hash?: string | null
          package_json?: string
          package_status?: string
          project_id?: string
          source_project_ids?: string[]
          source_snapshot_at?: string
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_record_copilot_data_packag_governance_record_id_fkey"
            columns: ["governance_record_id"]
            isOneToOne: false
            referencedRelation: "governance_records"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_record_cross_project_links: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          governance_record_id: string
          id: string
          included_in_package: boolean
          linked_project_id: string
          linked_project_workspace_id: string
          organization_id: string
          project_id: string
          relationship_reason: string | null
          relationship_type: string
          source_dependency_id: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          governance_record_id: string
          id?: string
          included_in_package?: boolean
          linked_project_id: string
          linked_project_workspace_id: string
          organization_id: string
          project_id: string
          relationship_reason?: string | null
          relationship_type: string
          source_dependency_id?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          governance_record_id?: string
          id?: string
          included_in_package?: boolean
          linked_project_id?: string
          linked_project_workspace_id?: string
          organization_id?: string
          project_id?: string
          relationship_reason?: string | null
          relationship_type?: string
          source_dependency_id?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_record_cross_projec_linked_project_workspace_id_fkey"
            columns: ["linked_project_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_cross_project_links_governance_record_id_fkey"
            columns: ["governance_record_id"]
            isOneToOne: false
            referencedRelation: "governance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_cross_project_links_linked_project_id_fkey"
            columns: ["linked_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_cross_project_links_source_dependency_id_fkey"
            columns: ["source_dependency_id"]
            isOneToOne: false
            referencedRelation: "dependencies"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_record_decision_outcomes: {
        Row: {
          approval_forum: string | null
          closed_at: string | null
          closed_by: string | null
          closure_note: string | null
          conditions_guardrails: string | null
          created_at: string
          created_by: string | null
          decided_by_text: string | null
          decision_date: string
          decision_rationale: string | null
          decision_result: string
          final_decision_text: string
          follow_up_actions: string | null
          governance_record_id: string
          id: string
          implementation_owner_stakeholder_id: string | null
          implementation_target_date: string | null
          organization_id: string
          project_id: string
          residual_risks: string | null
          signoff_evidence_url: string | null
          signoff_status: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          approval_forum?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closure_note?: string | null
          conditions_guardrails?: string | null
          created_at?: string
          created_by?: string | null
          decided_by_text?: string | null
          decision_date: string
          decision_rationale?: string | null
          decision_result: string
          final_decision_text: string
          follow_up_actions?: string | null
          governance_record_id: string
          id?: string
          implementation_owner_stakeholder_id?: string | null
          implementation_target_date?: string | null
          organization_id: string
          project_id: string
          residual_risks?: string | null
          signoff_evidence_url?: string | null
          signoff_status?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          approval_forum?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closure_note?: string | null
          conditions_guardrails?: string | null
          created_at?: string
          created_by?: string | null
          decided_by_text?: string | null
          decision_date?: string
          decision_rationale?: string | null
          decision_result?: string
          final_decision_text?: string
          follow_up_actions?: string | null
          governance_record_id?: string
          id?: string
          implementation_owner_stakeholder_id?: string | null
          implementation_target_date?: string | null
          organization_id?: string
          project_id?: string
          residual_risks?: string | null
          signoff_evidence_url?: string | null
          signoff_status?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_record_decision_ou_implementation_owner_stakeho_fkey"
            columns: ["implementation_owner_stakeholder_id"]
            isOneToOne: false
            referencedRelation: "project_stakeholders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_decision_outcomes_governance_record_id_fkey"
            columns: ["governance_record_id"]
            isOneToOne: true
            referencedRelation: "governance_records"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_record_decisions: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          decision_owner_id: string | null
          decision_owner_stakeholder_id: string | null
          decision_text: string
          governance_record_id: string
          id: string
          organization_id: string
          project_id: string
          target_date: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          decision_owner_id?: string | null
          decision_owner_stakeholder_id?: string | null
          decision_text: string
          governance_record_id: string
          id?: string
          organization_id: string
          project_id: string
          target_date?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          decision_owner_id?: string | null
          decision_owner_stakeholder_id?: string | null
          decision_text?: string
          governance_record_id?: string
          id?: string
          organization_id?: string
          project_id?: string
          target_date?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_record_decisions_decision_owner_id_fkey"
            columns: ["decision_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_decisions_decision_owner_stakeholder_id_fkey"
            columns: ["decision_owner_stakeholder_id"]
            isOneToOne: false
            referencedRelation: "project_stakeholders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_decisions_governance_record_id_fkey"
            columns: ["governance_record_id"]
            isOneToOne: false
            referencedRelation: "governance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_decisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "governance_record_decisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_decisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_decisions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_record_evidence_files: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          ctag: string | null
          drive_id: string
          etag: string | null
          evidence_date: string | null
          evidence_summary: string | null
          evidence_title: string
          file_extension: string | null
          file_name: string
          governance_record_id: string
          id: string
          included_in_package: boolean
          item_id: string
          item_reference_hash: string
          mime_type: string | null
          organization_id: string
          parent_path: string | null
          project_id: string
          relevance_level: string
          selected_at: string
          selected_by: string | null
          sharepoint_created_at: string | null
          sharepoint_last_modified_at: string | null
          sharepoint_web_url: string | null
          site_id: string
          size_bytes: number | null
          source_system: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          ctag?: string | null
          drive_id: string
          etag?: string | null
          evidence_date?: string | null
          evidence_summary?: string | null
          evidence_title: string
          file_extension?: string | null
          file_name: string
          governance_record_id: string
          id?: string
          included_in_package?: boolean
          item_id: string
          item_reference_hash: string
          mime_type?: string | null
          organization_id: string
          parent_path?: string | null
          project_id: string
          relevance_level?: string
          selected_at?: string
          selected_by?: string | null
          sharepoint_created_at?: string | null
          sharepoint_last_modified_at?: string | null
          sharepoint_web_url?: string | null
          site_id: string
          size_bytes?: number | null
          source_system?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          ctag?: string | null
          drive_id?: string
          etag?: string | null
          evidence_date?: string | null
          evidence_summary?: string | null
          evidence_title?: string
          file_extension?: string | null
          file_name?: string
          governance_record_id?: string
          id?: string
          included_in_package?: boolean
          item_id?: string
          item_reference_hash?: string
          mime_type?: string | null
          organization_id?: string
          parent_path?: string | null
          project_id?: string
          relevance_level?: string
          selected_at?: string
          selected_by?: string | null
          sharepoint_created_at?: string | null
          sharepoint_last_modified_at?: string | null
          sharepoint_web_url?: string | null
          site_id?: string
          size_bytes?: number | null
          source_system?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_record_evidence_files_governance_record_id_fkey"
            columns: ["governance_record_id"]
            isOneToOne: false
            referencedRelation: "governance_records"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_record_evidence_references: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          evidence_date: string | null
          evidence_type: string
          external_url: string
          governance_record_id: string
          id: string
          included_in_package: boolean
          organization_id: string
          owner_stakeholder_id: string | null
          project_id: string
          relevance_level: string
          summary: string | null
          title: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          evidence_date?: string | null
          evidence_type: string
          external_url: string
          governance_record_id: string
          id?: string
          included_in_package?: boolean
          organization_id: string
          owner_stakeholder_id?: string | null
          project_id: string
          relevance_level?: string
          summary?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          evidence_date?: string | null
          evidence_type?: string
          external_url?: string
          governance_record_id?: string
          id?: string
          included_in_package?: boolean
          organization_id?: string
          owner_stakeholder_id?: string | null
          project_id?: string
          relevance_level?: string
          summary?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_record_evidence_references_governance_record_id_fkey"
            columns: ["governance_record_id"]
            isOneToOne: false
            referencedRelation: "governance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_evidence_references_owner_stakeholder_id_fkey"
            columns: ["owner_stakeholder_id"]
            isOneToOne: false
            referencedRelation: "project_stakeholders"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_record_links: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          governance_record_id: string
          id: string
          linked_object_id: string
          linked_object_type: string
          organization_id: string
          project_id: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          governance_record_id: string
          id?: string
          linked_object_id: string
          linked_object_type: string
          organization_id: string
          project_id: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          governance_record_id?: string
          id?: string
          linked_object_id?: string
          linked_object_type?: string
          organization_id?: string
          project_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_record_links_governance_record_id_fkey"
            columns: ["governance_record_id"]
            isOneToOne: false
            referencedRelation: "governance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "governance_record_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_record_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_record_stakeholder_packages: {
        Row: {
          audience_text: string | null
          background_context: string | null
          created_at: string
          created_by: string | null
          decision_ask_text: string | null
          decision_question_text: string | null
          distribution_evidence_url: string | null
          distribution_note: string | null
          evidence_summary: string | null
          executive_summary: string | null
          governance_record_id: string
          guardrails_text: string | null
          id: string
          is_current: boolean
          next_steps_text: string | null
          options_summary: string | null
          organization_id: string
          package_status: string
          package_title: string
          project_id: string
          provided_to_stakeholders_at: string | null
          provided_to_stakeholders_by: string | null
          recommendation_text: string | null
          residual_risks_text: string | null
          updated_at: string
          updated_by: string | null
          version_number: number
          workspace_id: string
        }
        Insert: {
          audience_text?: string | null
          background_context?: string | null
          created_at?: string
          created_by?: string | null
          decision_ask_text?: string | null
          decision_question_text?: string | null
          distribution_evidence_url?: string | null
          distribution_note?: string | null
          evidence_summary?: string | null
          executive_summary?: string | null
          governance_record_id: string
          guardrails_text?: string | null
          id?: string
          is_current?: boolean
          next_steps_text?: string | null
          options_summary?: string | null
          organization_id: string
          package_status?: string
          package_title: string
          project_id: string
          provided_to_stakeholders_at?: string | null
          provided_to_stakeholders_by?: string | null
          recommendation_text?: string | null
          residual_risks_text?: string | null
          updated_at?: string
          updated_by?: string | null
          version_number: number
          workspace_id: string
        }
        Update: {
          audience_text?: string | null
          background_context?: string | null
          created_at?: string
          created_by?: string | null
          decision_ask_text?: string | null
          decision_question_text?: string | null
          distribution_evidence_url?: string | null
          distribution_note?: string | null
          evidence_summary?: string | null
          executive_summary?: string | null
          governance_record_id?: string
          guardrails_text?: string | null
          id?: string
          is_current?: boolean
          next_steps_text?: string | null
          options_summary?: string | null
          organization_id?: string
          package_status?: string
          package_title?: string
          project_id?: string
          provided_to_stakeholders_at?: string | null
          provided_to_stakeholders_by?: string | null
          recommendation_text?: string | null
          residual_risks_text?: string | null
          updated_at?: string
          updated_by?: string | null
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_record_stakeholder_package_governance_record_id_fkey"
            columns: ["governance_record_id"]
            isOneToOne: false
            referencedRelation: "governance_records"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_records: {
        Row: {
          actual_date_held: string
          archived_at: string | null
          archived_by: string | null
          cadence_id: string | null
          created_at: string
          created_by: string | null
          decision_owner_stakeholder_id: string | null
          decision_question: string | null
          decision_stage: string | null
          decisions_summary: string | null
          event_name: string | null
          event_type: string
          expected_date_snapshot: string | null
          external_reference_url: string | null
          id: string
          organization_id: string
          project_id: string
          record_kind: string
          sharepoint_evidence_reference: string | null
          summary: string | null
          target_decision_date: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          actual_date_held: string
          archived_at?: string | null
          archived_by?: string | null
          cadence_id?: string | null
          created_at?: string
          created_by?: string | null
          decision_owner_stakeholder_id?: string | null
          decision_question?: string | null
          decision_stage?: string | null
          decisions_summary?: string | null
          event_name?: string | null
          event_type: string
          expected_date_snapshot?: string | null
          external_reference_url?: string | null
          id?: string
          organization_id: string
          project_id: string
          record_kind?: string
          sharepoint_evidence_reference?: string | null
          summary?: string | null
          target_decision_date?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          actual_date_held?: string
          archived_at?: string | null
          archived_by?: string | null
          cadence_id?: string | null
          created_at?: string
          created_by?: string | null
          decision_owner_stakeholder_id?: string | null
          decision_question?: string | null
          decision_stage?: string | null
          decisions_summary?: string | null
          event_name?: string | null
          event_type?: string
          expected_date_snapshot?: string | null
          external_reference_url?: string | null
          id?: string
          organization_id?: string
          project_id?: string
          record_kind?: string
          sharepoint_evidence_reference?: string | null
          summary?: string | null
          target_decision_date?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_records_cadence_id_fkey"
            columns: ["cadence_id"]
            isOneToOne: false
            referencedRelation: "governance_cadences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_records_decision_owner_stakeholder_id_fkey"
            columns: ["decision_owner_stakeholder_id"]
            isOneToOne: false
            referencedRelation: "project_stakeholders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "governance_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          organization_role:
            | Database["public"]["Enums"]["organization_role"]
            | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          tenant_id: string
          tenant_role: Database["public"]["Enums"]["tenant_role"] | null
          token: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          organization_id: string
          organization_role?:
            | Database["public"]["Enums"]["organization_role"]
            | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          tenant_id: string
          tenant_role?: Database["public"]["Enums"]["tenant_role"] | null
          token: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          organization_role?:
            | Database["public"]["Enums"]["organization_role"]
            | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          tenant_id?: string
          tenant_role?: Database["public"]["Enums"]["tenant_role"] | null
          token?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_article_ai_metadata: {
        Row: {
          ai_flow: string
          answer_rules_protected: string | null
          article_id: string
          audience: string[]
          created_at: string
          created_by: string | null
          feature_area: string[]
          forbidden_claims_protected: string | null
          freshness_label: string
          id: string
          organization_id: string
          question_examples_protected: string | null
          related_feature_flags: string[]
          route_patterns: string[]
          synonyms: string[]
          updated_at: string
          updated_by: string | null
          user_intents: string[]
          workflow_metadata_protected: string | null
        }
        Insert: {
          ai_flow?: string
          answer_rules_protected?: string | null
          article_id: string
          audience?: string[]
          created_at?: string
          created_by?: string | null
          feature_area?: string[]
          forbidden_claims_protected?: string | null
          freshness_label?: string
          id?: string
          organization_id: string
          question_examples_protected?: string | null
          related_feature_flags?: string[]
          route_patterns?: string[]
          synonyms?: string[]
          updated_at?: string
          updated_by?: string | null
          user_intents?: string[]
          workflow_metadata_protected?: string | null
        }
        Update: {
          ai_flow?: string
          answer_rules_protected?: string | null
          article_id?: string
          audience?: string[]
          created_at?: string
          created_by?: string | null
          feature_area?: string[]
          forbidden_claims_protected?: string | null
          freshness_label?: string
          id?: string
          organization_id?: string
          question_examples_protected?: string | null
          related_feature_flags?: string[]
          route_patterns?: string[]
          synonyms?: string[]
          updated_at?: string
          updated_by?: string | null
          user_intents?: string[]
          workflow_metadata_protected?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_article_ai_metadata_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: true
            referencedRelation: "knowledge_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_article_ai_metadata_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "knowledge_article_ai_metadata_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_articles: {
        Row: {
          archived_at: string | null
          article_type: Database["public"]["Enums"]["knowledge_article_type"]
          body: string | null
          category_id: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          owner_id: string | null
          published_at: string | null
          related_object_id: string | null
          related_object_type: string | null
          related_route: string | null
          slug: string
          status: Database["public"]["Enums"]["knowledge_article_status"]
          summary: string | null
          title: string
          tooltip_excerpt: string | null
          updated_at: string
          updated_by: string | null
          version: number
          visibility: Database["public"]["Enums"]["knowledge_article_visibility"]
          workspace_id: string | null
        }
        Insert: {
          archived_at?: string | null
          article_type?: Database["public"]["Enums"]["knowledge_article_type"]
          body?: string | null
          category_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          owner_id?: string | null
          published_at?: string | null
          related_object_id?: string | null
          related_object_type?: string | null
          related_route?: string | null
          slug: string
          status?: Database["public"]["Enums"]["knowledge_article_status"]
          summary?: string | null
          title: string
          tooltip_excerpt?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
          visibility?: Database["public"]["Enums"]["knowledge_article_visibility"]
          workspace_id?: string | null
        }
        Update: {
          archived_at?: string | null
          article_type?: Database["public"]["Enums"]["knowledge_article_type"]
          body?: string | null
          category_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          owner_id?: string | null
          published_at?: string | null
          related_object_id?: string | null
          related_object_type?: string | null
          related_route?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["knowledge_article_status"]
          summary?: string | null
          title?: string
          tooltip_excerpt?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
          visibility?: Database["public"]["Enums"]["knowledge_article_visibility"]
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_articles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "knowledge_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_articles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "knowledge_articles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_articles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_categories: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          slug: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          slug: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          slug?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "knowledge_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_app_external_kpis: {
        Row: {
          created_at: string
          created_by: string | null
          default_currency_id: number
          default_scenario_id: number
          description: string | null
          external_kpi_id: number
          external_kpi_name: string
          id: string
          is_active: boolean
          organization_id: string
          updated_at: string
          updated_by: string | null
          value_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_currency_id?: number
          default_scenario_id?: number
          description?: string | null
          external_kpi_id: number
          external_kpi_name: string
          id?: string
          is_active?: boolean
          organization_id: string
          updated_at?: string
          updated_by?: string | null
          value_type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_currency_id?: number
          default_scenario_id?: number
          description?: string | null
          external_kpi_id?: number
          external_kpi_name?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
          value_type?: string
        }
        Relationships: []
      }
      kpi_app_mappings: {
        Row: {
          action_plan_source: string
          auto_submit_enabled: boolean
          carry_forward_allowed: boolean
          comment_source: string
          created_at: string
          created_by: string | null
          currency_id: number
          entered_by_email_source: string
          entered_by_user_id: string | null
          external_kpi_id: number
          id: string
          is_active: boolean
          kpi_definition_id: string
          last_submission_status: string | null
          last_submitted_at: string | null
          last_submitted_snapshot_id: string | null
          organization_id: string
          project_id: string
          reporting_frequency: string
          scenario_id: number
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          action_plan_source?: string
          auto_submit_enabled?: boolean
          carry_forward_allowed?: boolean
          comment_source?: string
          created_at?: string
          created_by?: string | null
          currency_id?: number
          entered_by_email_source?: string
          entered_by_user_id?: string | null
          external_kpi_id: number
          id?: string
          is_active?: boolean
          kpi_definition_id: string
          last_submission_status?: string | null
          last_submitted_at?: string | null
          last_submitted_snapshot_id?: string | null
          organization_id: string
          project_id: string
          reporting_frequency?: string
          scenario_id?: number
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          action_plan_source?: string
          auto_submit_enabled?: boolean
          carry_forward_allowed?: boolean
          comment_source?: string
          created_at?: string
          created_by?: string | null
          currency_id?: number
          entered_by_email_source?: string
          entered_by_user_id?: string | null
          external_kpi_id?: number
          id?: string
          is_active?: boolean
          kpi_definition_id?: string
          last_submission_status?: string | null
          last_submitted_at?: string | null
          last_submitted_snapshot_id?: string | null
          organization_id?: string
          project_id?: string
          reporting_frequency?: string
          scenario_id?: number
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_app_map_catalog_fk"
            columns: ["organization_id", "external_kpi_id"]
            isOneToOne: false
            referencedRelation: "kpi_app_external_kpis"
            referencedColumns: ["organization_id", "external_kpi_id"]
          },
          {
            foreignKeyName: "kpi_app_mappings_kpi_definition_id_fkey"
            columns: ["kpi_definition_id"]
            isOneToOne: false
            referencedRelation: "kpi_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_app_scheduler_run_items: {
        Row: {
          action: string
          attempt_id: string | null
          btpm_kpi_name: string | null
          carry_forward_used: boolean | null
          code: string | null
          created_at: string
          external_kpi_id: number | null
          external_kpi_name: string | null
          http_status: number | null
          id: string
          kpi_definition_id: string | null
          mapping_id: string | null
          organization_id: string
          outbox_id: string | null
          outbox_status: string | null
          payload_row_count: number | null
          payload_summary: Json
          project_id: string | null
          project_name: string | null
          reason: string | null
          reporting_period_end: string | null
          reporting_period_start: string | null
          run_id: string
          safe_endpoint_summary: Json
          source_snapshot_id: string | null
          source_snapshot_period_end: string | null
          source_snapshot_period_start: string | null
          upstream_status_text: string | null
          validity_date: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          attempt_id?: string | null
          btpm_kpi_name?: string | null
          carry_forward_used?: boolean | null
          code?: string | null
          created_at?: string
          external_kpi_id?: number | null
          external_kpi_name?: string | null
          http_status?: number | null
          id?: string
          kpi_definition_id?: string | null
          mapping_id?: string | null
          organization_id: string
          outbox_id?: string | null
          outbox_status?: string | null
          payload_row_count?: number | null
          payload_summary?: Json
          project_id?: string | null
          project_name?: string | null
          reason?: string | null
          reporting_period_end?: string | null
          reporting_period_start?: string | null
          run_id: string
          safe_endpoint_summary?: Json
          source_snapshot_id?: string | null
          source_snapshot_period_end?: string | null
          source_snapshot_period_start?: string | null
          upstream_status_text?: string | null
          validity_date?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          attempt_id?: string | null
          btpm_kpi_name?: string | null
          carry_forward_used?: boolean | null
          code?: string | null
          created_at?: string
          external_kpi_id?: number | null
          external_kpi_name?: string | null
          http_status?: number | null
          id?: string
          kpi_definition_id?: string | null
          mapping_id?: string | null
          organization_id?: string
          outbox_id?: string | null
          outbox_status?: string | null
          payload_row_count?: number | null
          payload_summary?: Json
          project_id?: string | null
          project_name?: string | null
          reason?: string | null
          reporting_period_end?: string | null
          reporting_period_start?: string | null
          run_id?: string
          safe_endpoint_summary?: Json
          source_snapshot_id?: string | null
          source_snapshot_period_end?: string | null
          source_snapshot_period_start?: string | null
          upstream_status_text?: string | null
          validity_date?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_app_scheduler_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "kpi_app_scheduler_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_app_scheduler_runs: {
        Row: {
          as_of_date: string
          cadence: string
          candidate_count: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          failed_count: number
          id: string
          invocation_source: string
          mode: string
          not_reportable_count: number
          organization_id: string
          outbox_created_count: number
          outbox_reused_count: number
          reporting_period_end: string | null
          reporting_period_start: string | null
          request_id: string | null
          skipped_count: number
          started_at: string
          status: string
          submitted_count: number
          summary: Json
          workspace_id: string | null
        }
        Insert: {
          as_of_date: string
          cadence?: string
          candidate_count?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          failed_count?: number
          id?: string
          invocation_source: string
          mode: string
          not_reportable_count?: number
          organization_id: string
          outbox_created_count?: number
          outbox_reused_count?: number
          reporting_period_end?: string | null
          reporting_period_start?: string | null
          request_id?: string | null
          skipped_count?: number
          started_at?: string
          status?: string
          submitted_count?: number
          summary?: Json
          workspace_id?: string | null
        }
        Update: {
          as_of_date?: string
          cadence?: string
          candidate_count?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          failed_count?: number
          id?: string
          invocation_source?: string
          mode?: string
          not_reportable_count?: number
          organization_id?: string
          outbox_created_count?: number
          outbox_reused_count?: number
          reporting_period_end?: string | null
          reporting_period_start?: string | null
          request_id?: string | null
          skipped_count?: number
          started_at?: string
          status?: string
          submitted_count?: number
          summary?: Json
          workspace_id?: string | null
        }
        Relationships: []
      }
      kpi_app_submission_attempts: {
        Row: {
          attempt_number: number
          attempted_at: string
          attempted_by: string | null
          created_at: string
          elapsed_ms: number | null
          error_message: string | null
          external_correlation_id: string | null
          http_status: number | null
          id: string
          outbox_id: string
          payload_hash: string | null
          payload_row_count: number | null
          payload_summary: Json | null
          request_id: string | null
          status: string
          upstream_body_summary: string | null
          upstream_status_text: string | null
        }
        Insert: {
          attempt_number: number
          attempted_at?: string
          attempted_by?: string | null
          created_at?: string
          elapsed_ms?: number | null
          error_message?: string | null
          external_correlation_id?: string | null
          http_status?: number | null
          id?: string
          outbox_id: string
          payload_hash?: string | null
          payload_row_count?: number | null
          payload_summary?: Json | null
          request_id?: string | null
          status: string
          upstream_body_summary?: string | null
          upstream_status_text?: string | null
        }
        Update: {
          attempt_number?: number
          attempted_at?: string
          attempted_by?: string | null
          created_at?: string
          elapsed_ms?: number | null
          error_message?: string | null
          external_correlation_id?: string | null
          http_status?: number | null
          id?: string
          outbox_id?: string
          payload_hash?: string | null
          payload_row_count?: number | null
          payload_summary?: Json | null
          request_id?: string | null
          status?: string
          upstream_body_summary?: string | null
          upstream_status_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_app_submission_attempts_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "kpi_app_submission_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_app_submission_outbox: {
        Row: {
          carry_forward_used: boolean
          created_at: string
          created_by: string | null
          external_correlation_id: string | null
          id: string
          kpi_definition_id: string
          last_attempt_at: string | null
          last_error_message: string | null
          last_http_status: number | null
          last_upstream_body_summary: string | null
          last_upstream_status_text: string | null
          mapping_id: string
          organization_id: string
          payload_hash: string | null
          payload_row_count: number | null
          payload_summary: Json | null
          project_id: string
          replacement_outbox_id: string | null
          reporting_period_end: string
          reporting_period_start: string
          retry_count: number
          source_action_plan: string | null
          source_comment: string | null
          source_snapshot_id: string
          source_snapshot_period_end: string | null
          source_snapshot_period_start: string | null
          source_string_value: string | null
          source_value_amount: number | null
          source_value_type: string
          status: string
          submission_mode: string
          submitted_at: string | null
          submitted_by: string | null
          superseded_at: string | null
          superseded_by: string | null
          superseded_reason: string | null
          updated_at: string
          updated_by: string | null
          validity_date: string
          workspace_id: string
        }
        Insert: {
          carry_forward_used?: boolean
          created_at?: string
          created_by?: string | null
          external_correlation_id?: string | null
          id?: string
          kpi_definition_id: string
          last_attempt_at?: string | null
          last_error_message?: string | null
          last_http_status?: number | null
          last_upstream_body_summary?: string | null
          last_upstream_status_text?: string | null
          mapping_id: string
          organization_id: string
          payload_hash?: string | null
          payload_row_count?: number | null
          payload_summary?: Json | null
          project_id: string
          replacement_outbox_id?: string | null
          reporting_period_end: string
          reporting_period_start: string
          retry_count?: number
          source_action_plan?: string | null
          source_comment?: string | null
          source_snapshot_id: string
          source_snapshot_period_end?: string | null
          source_snapshot_period_start?: string | null
          source_string_value?: string | null
          source_value_amount?: number | null
          source_value_type: string
          status?: string
          submission_mode: string
          submitted_at?: string | null
          submitted_by?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          superseded_reason?: string | null
          updated_at?: string
          updated_by?: string | null
          validity_date: string
          workspace_id: string
        }
        Update: {
          carry_forward_used?: boolean
          created_at?: string
          created_by?: string | null
          external_correlation_id?: string | null
          id?: string
          kpi_definition_id?: string
          last_attempt_at?: string | null
          last_error_message?: string | null
          last_http_status?: number | null
          last_upstream_body_summary?: string | null
          last_upstream_status_text?: string | null
          mapping_id?: string
          organization_id?: string
          payload_hash?: string | null
          payload_row_count?: number | null
          payload_summary?: Json | null
          project_id?: string
          replacement_outbox_id?: string | null
          reporting_period_end?: string
          reporting_period_start?: string
          retry_count?: number
          source_action_plan?: string | null
          source_comment?: string | null
          source_snapshot_id?: string
          source_snapshot_period_end?: string | null
          source_snapshot_period_start?: string | null
          source_string_value?: string | null
          source_value_amount?: number | null
          source_value_type?: string
          status?: string
          submission_mode?: string
          submitted_at?: string | null
          submitted_by?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          superseded_reason?: string | null
          updated_at?: string
          updated_by?: string | null
          validity_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_app_submission_outbox_mapping_id_fkey"
            columns: ["mapping_id"]
            isOneToOne: false
            referencedRelation: "kpi_app_mappings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_app_submission_outbox_replacement_outbox_id_fkey"
            columns: ["replacement_outbox_id"]
            isOneToOne: false
            referencedRelation: "kpi_app_submission_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_app_submission_outbox_source_snapshot_id_fkey"
            columns: ["source_snapshot_id"]
            isOneToOne: false
            referencedRelation: "kpi_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_definitions: {
        Row: {
          action_plan_required: boolean
          auto_snapshot_enabled: boolean
          cadence: string
          calculation_key: string | null
          comment_required: boolean
          completion_method: string | null
          created_at: string
          created_by: string | null
          current_value: number | null
          description: string | null
          formula_version: number | null
          id: string
          is_archived: boolean
          name: string
          organization_id: string
          source_mode: string
          target_direction: Database["public"]["Enums"]["kpi_target_direction"]
          target_id: string
          target_type: string
          target_value: number | null
          unit: string | null
          updated_at: string
          value_type: string
          workspace_id: string
        }
        Insert: {
          action_plan_required?: boolean
          auto_snapshot_enabled?: boolean
          cadence?: string
          calculation_key?: string | null
          comment_required?: boolean
          completion_method?: string | null
          created_at?: string
          created_by?: string | null
          current_value?: number | null
          description?: string | null
          formula_version?: number | null
          id?: string
          is_archived?: boolean
          name: string
          organization_id: string
          source_mode?: string
          target_direction?: Database["public"]["Enums"]["kpi_target_direction"]
          target_id: string
          target_type: string
          target_value?: number | null
          unit?: string | null
          updated_at?: string
          value_type?: string
          workspace_id: string
        }
        Update: {
          action_plan_required?: boolean
          auto_snapshot_enabled?: boolean
          cadence?: string
          calculation_key?: string | null
          comment_required?: boolean
          completion_method?: string | null
          created_at?: string
          created_by?: string | null
          current_value?: number | null
          description?: string | null
          formula_version?: number | null
          id?: string
          is_archived?: boolean
          name?: string
          organization_id?: string
          source_mode?: string
          target_direction?: Database["public"]["Enums"]["kpi_target_direction"]
          target_id?: string
          target_type?: string
          target_value?: number | null
          unit?: string | null
          updated_at?: string
          value_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "kpi_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_definitions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_schedule_policies: {
        Row: {
          cadence: string
          created_at: string
          created_by: string | null
          delay_days_after_period_close: number
          id: string
          is_active: boolean
          organization_id: string
          process_type: string
          run_time_utc: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          cadence: string
          created_at?: string
          created_by?: string | null
          delay_days_after_period_close: number
          id?: string
          is_active?: boolean
          organization_id: string
          process_type: string
          run_time_utc: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          cadence?: string
          created_at?: string
          created_by?: string | null
          delay_days_after_period_close?: number
          id?: string
          is_active?: boolean
          organization_id?: string
          process_type?: string
          run_time_utc?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_schedule_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "kpi_schedule_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_schedule_policies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_snapshot_capture_run_items: {
        Row: {
          action: string
          cadence: string
          calculation_key: string | null
          calculation_status: string | null
          created_at: string
          existing_snapshot_id: string | null
          id: string
          kpi_definition_id: string
          kpi_name: string | null
          organization_id: string
          period_end: string | null
          period_start: string | null
          project_id: string
          project_name: string | null
          reason: string | null
          run_id: string
          snapshot_id: string | null
          validity_date: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          cadence: string
          calculation_key?: string | null
          calculation_status?: string | null
          created_at?: string
          existing_snapshot_id?: string | null
          id?: string
          kpi_definition_id: string
          kpi_name?: string | null
          organization_id: string
          period_end?: string | null
          period_start?: string | null
          project_id: string
          project_name?: string | null
          reason?: string | null
          run_id: string
          snapshot_id?: string | null
          validity_date?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          cadence?: string
          calculation_key?: string | null
          calculation_status?: string | null
          created_at?: string
          existing_snapshot_id?: string | null
          id?: string
          kpi_definition_id?: string
          kpi_name?: string | null
          organization_id?: string
          period_end?: string | null
          period_start?: string | null
          project_id?: string
          project_name?: string | null
          reason?: string | null
          run_id?: string
          snapshot_id?: string | null
          validity_date?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_snapshot_capture_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "kpi_snapshot_capture_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_snapshot_capture_runs: {
        Row: {
          as_of_date: string
          calculation_not_ready_count: number
          candidate_count: number
          completed_at: string | null
          created_at: string
          created_count: number
          error_message: string | null
          failed_count: number
          id: string
          invocation_source: string
          mode: string
          organization_id: string
          requested_by: string | null
          skipped_existing_snapshot_count: number
          skipped_not_eligible_count: number
          started_at: string
          status: string
          summary: Json | null
          workspace_id: string | null
        }
        Insert: {
          as_of_date: string
          calculation_not_ready_count?: number
          candidate_count?: number
          completed_at?: string | null
          created_at?: string
          created_count?: number
          error_message?: string | null
          failed_count?: number
          id?: string
          invocation_source: string
          mode: string
          organization_id: string
          requested_by?: string | null
          skipped_existing_snapshot_count?: number
          skipped_not_eligible_count?: number
          started_at?: string
          status?: string
          summary?: Json | null
          workspace_id?: string | null
        }
        Update: {
          as_of_date?: string
          calculation_not_ready_count?: number
          candidate_count?: number
          completed_at?: string | null
          created_at?: string
          created_count?: number
          error_message?: string | null
          failed_count?: number
          id?: string
          invocation_source?: string
          mode?: string
          organization_id?: string
          requested_by?: string | null
          skipped_existing_snapshot_count?: number
          skipped_not_eligible_count?: number
          started_at?: string
          status?: string
          summary?: Json | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      kpi_snapshots: {
        Row: {
          action_plan: string | null
          calculation_key: string | null
          calculation_status: string
          comment: string | null
          created_at: string
          created_by: string | null
          formula_version: number | null
          generated_by: string
          id: string
          kpi_definition_id: string
          organization_id: string
          period_end: string | null
          period_start: string | null
          project_id: string
          snapshot_date: string
          source_mode: string
          string_value: string | null
          value_amount: number | null
          value_type: string
          workspace_id: string
        }
        Insert: {
          action_plan?: string | null
          calculation_key?: string | null
          calculation_status: string
          comment?: string | null
          created_at?: string
          created_by?: string | null
          formula_version?: number | null
          generated_by: string
          id?: string
          kpi_definition_id: string
          organization_id: string
          period_end?: string | null
          period_start?: string | null
          project_id: string
          snapshot_date: string
          source_mode: string
          string_value?: string | null
          value_amount?: number | null
          value_type: string
          workspace_id: string
        }
        Update: {
          action_plan?: string | null
          calculation_key?: string | null
          calculation_status?: string
          comment?: string | null
          created_at?: string
          created_by?: string | null
          formula_version?: number | null
          generated_by?: string
          id?: string
          kpi_definition_id?: string
          organization_id?: string
          period_end?: string | null
          period_start?: string | null
          project_id?: string
          snapshot_date?: string
          source_mode?: string
          string_value?: string | null
          value_amount?: number | null
          value_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_snapshots_kpi_definition_id_fkey"
            columns: ["kpi_definition_id"]
            isOneToOne: false
            referencedRelation: "kpi_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "kpi_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_updates: {
        Row: {
          author_id: string
          created_at: string
          id: string
          kpi_definition_id: string
          note: string | null
          organization_id: string
          update_date: string
          value: number
          workspace_id: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          kpi_definition_id: string
          note?: string | null
          organization_id: string
          update_date?: string
          value: number
          workspace_id: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          kpi_definition_id?: string
          note?: string | null
          organization_id?: string
          update_date?: string
          value?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_updates_kpi_definition_id_fkey"
            columns: ["kpi_definition_id"]
            isOneToOne: false
            referencedRelation: "kpi_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_updates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "kpi_updates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_updates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          actor_id: string | null
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          idempotency_key: string
          organization_id: string
          payload: string | null
          recipient_id: string
          retry_count: number
          sent_at: string | null
          source_comment_id: string | null
          status: string
          target_id: string
          target_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          idempotency_key: string
          organization_id: string
          payload?: string | null
          recipient_id: string
          retry_count?: number
          sent_at?: string | null
          source_comment_id?: string | null
          status?: string
          target_id: string
          target_type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          payload?: string | null
          recipient_id?: string
          retry_count?: number
          sent_at?: string | null
          source_comment_id?: string | null
          status?: string
          target_id?: string
          target_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      organization_encryption_keys: {
        Row: {
          created_at: string
          id: string
          key_scope: string
          key_status: string
          key_version: number
          last_rotated_at: string | null
          legacy_key_name: string | null
          metadata: Json
          organization_id: string
          tenant_encryption_key_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_scope?: string
          key_status?: string
          key_version?: number
          last_rotated_at?: string | null
          legacy_key_name?: string | null
          metadata?: Json
          organization_id: string
          tenant_encryption_key_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          key_scope?: string
          key_status?: string
          key_version?: number
          last_rotated_at?: string | null
          legacy_key_name?: string | null
          metadata?: Json
          organization_id?: string
          tenant_encryption_key_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_encryption_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_encryption_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_encryption_keys_tenant_encryption_key_id_fkey"
            columns: ["tenant_encryption_key_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_encryption_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "organization_encryption_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          deactivation_reason: string | null
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_role"]
          status: Database["public"]["Enums"]["membership_status"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["organization_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "organization_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_secret_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          integration_id: string
          is_disabled: boolean
          organization_id: string
          override_reason: string | null
          secret_name: string | null
          secret_ref_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          integration_id: string
          is_disabled?: boolean
          organization_id: string
          override_reason?: string | null
          secret_name?: string | null
          secret_ref_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          integration_id?: string
          is_disabled?: boolean
          organization_id?: string
          override_reason?: string | null
          secret_name?: string | null
          secret_ref_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_secret_overrides_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "tenant_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_secret_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_secret_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_secret_overrides_secret_ref_id_fkey"
            columns: ["secret_ref_id"]
            isOneToOne: false
            referencedRelation: "tenant_secret_refs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_secret_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "organization_secret_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          environment_role: Database["public"]["Enums"]["environment_role"]
          id: string
          name: string
          organization_kind: Database["public"]["Enums"]["organization_kind"]
          slug: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          environment_role?: Database["public"]["Enums"]["environment_role"]
          id?: string
          name: string
          organization_kind?: Database["public"]["Enums"]["organization_kind"]
          slug: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          environment_role?: Database["public"]["Enums"]["environment_role"]
          id?: string
          name?: string
          organization_kind?: Database["public"]["Enums"]["organization_kind"]
          slug?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "organizations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_email_events: {
        Row: {
          created_at: string
          email_type: string
          error_code: string | null
          event_key: string
          id: string
          metadata: Json
          organization_id: string
          project_id: string | null
          provider_message_id: string | null
          recipient_email: string
          recipient_user_id: string | null
          safe_error_message: string | null
          status: string
          task_id: string | null
          tenant_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          email_type: string
          error_code?: string | null
          event_key: string
          id?: string
          metadata?: Json
          organization_id: string
          project_id?: string | null
          provider_message_id?: string | null
          recipient_email: string
          recipient_user_id?: string | null
          safe_error_message?: string | null
          status: string
          task_id?: string | null
          tenant_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          email_type?: string
          error_code?: string | null
          event_key?: string
          id?: string
          metadata?: Json
          organization_id?: string
          project_id?: string | null
          provider_message_id?: string | null
          recipient_email?: string
          recipient_user_id?: string | null
          safe_error_message?: string | null
          status?: string
          task_id?: string | null
          tenant_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outbound_email_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "outbound_email_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_email_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "outbound_email_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      phases: {
        Row: {
          actual_end_date: string | null
          actual_start_date: string | null
          added_after_baseline: boolean
          baseline_end_date: string | null
          baseline_start_date: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          name: string
          organization_id: string
          phase_type: Database["public"]["Enums"]["phase_type"]
          project_id: string
          sort_order: number
          start_date: string | null
          status: Database["public"]["Enums"]["pm_status"]
          target_end_date: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          added_after_baseline?: boolean
          baseline_end_date?: string | null
          baseline_start_date?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name: string
          organization_id: string
          phase_type?: Database["public"]["Enums"]["phase_type"]
          project_id: string
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["pm_status"]
          target_end_date?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          added_after_baseline?: boolean
          baseline_end_date?: string | null
          baseline_start_date?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          organization_id?: string
          phase_type?: Database["public"]["Enums"]["phase_type"]
          project_id?: string
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["pm_status"]
          target_end_date?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "phases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_background_jobs: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          failed_at: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          last_error: string | null
          max_attempts: number
          not_before: string | null
          payload: Json
          priority: number
          requested_by: string | null
          result: Json | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          failed_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type: string
          last_error?: string | null
          max_attempts?: number
          not_before?: string | null
          payload?: Json
          priority?: number
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          failed_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type?: string
          last_error?: string | null
          max_attempts?: number
          not_before?: string | null
          payload?: Json
          priority?: number
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_super_admins: {
        Row: {
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          deactivation_reason: string | null
          id: string
          is_active: boolean
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      pmg_command_audit: {
        Row: {
          actor_id: string | null
          command: string
          correlation_id: string | null
          created_at: string
          delegation_mode: string
          executing_user_id: string | null
          id: string
          idempotency_key: string | null
          integration_id: string | null
          metadata: Json
          organization_id: string | null
          project_id: string | null
          request_id: string | null
          requested_user_id: string | null
          source_channel: Database["public"]["Enums"]["pmg_source_channel"]
          source_client_id: string | null
          source_component: string | null
          source_system: string | null
          status: Database["public"]["Enums"]["pmg_command_status"]
          target_id: string | null
          target_type: string | null
          workspace_id: string | null
        }
        Insert: {
          actor_id?: string | null
          command: string
          correlation_id?: string | null
          created_at?: string
          delegation_mode?: string
          executing_user_id?: string | null
          id?: string
          idempotency_key?: string | null
          integration_id?: string | null
          metadata?: Json
          organization_id?: string | null
          project_id?: string | null
          request_id?: string | null
          requested_user_id?: string | null
          source_channel: Database["public"]["Enums"]["pmg_source_channel"]
          source_client_id?: string | null
          source_component?: string | null
          source_system?: string | null
          status: Database["public"]["Enums"]["pmg_command_status"]
          target_id?: string | null
          target_type?: string | null
          workspace_id?: string | null
        }
        Update: {
          actor_id?: string | null
          command?: string
          correlation_id?: string | null
          created_at?: string
          delegation_mode?: string
          executing_user_id?: string | null
          id?: string
          idempotency_key?: string | null
          integration_id?: string | null
          metadata?: Json
          organization_id?: string | null
          project_id?: string | null
          request_id?: string | null
          requested_user_id?: string | null
          source_channel?: Database["public"]["Enums"]["pmg_source_channel"]
          source_client_id?: string | null
          source_component?: string | null
          source_system?: string | null
          status?: Database["public"]["Enums"]["pmg_command_status"]
          target_id?: string | null
          target_type?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pmg_command_audit_executing_user_id_fkey"
            columns: ["executing_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pmg_command_audit_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "tenant_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pmg_command_audit_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "pmg_command_audit_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pmg_command_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pmg_command_audit_requested_user_id_fkey"
            columns: ["requested_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pmg_command_audit_source_client_id_fkey"
            columns: ["source_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pmg_command_audit_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_item_team_members: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          organization_id: string
          portfolio_item_id: string
          role: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          portfolio_item_id: string
          role: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          portfolio_item_id?: string
          role?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_item_team_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "portfolio_item_team_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_item_team_members_portfolio_item_id_fkey"
            columns: ["portfolio_item_id"]
            isOneToOne: false
            referencedRelation: "portfolio_items"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_items: {
        Row: {
          archived_at: string | null
          code: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          lifecycle_state: string
          name: string
          organization_id: string
          owner_id: string | null
          strategic_priority: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          lifecycle_state?: string
          name: string
          organization_id: string
          owner_id?: string | null
          strategic_priority?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          lifecycle_state?: string
          name?: string
          organization_id?: string
          owner_id?: string | null
          strategic_priority?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "portfolio_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      powerbi_data_scope_rules: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          project_id: string | null
          reason: string | null
          scope_mode: string
          scope_type: string
          updated_at: string
          updated_by: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          project_id?: string | null
          reason?: string | null
          scope_mode: string
          scope_type: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          project_id?: string | null
          reason?: string | null
          scope_mode?: string
          scope_type?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "powerbi_data_scope_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "powerbi_data_scope_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "powerbi_data_scope_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "powerbi_data_scope_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          is_active: boolean
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          is_active?: boolean
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          name: string
          organization_id: string
          status: Database["public"]["Enums"]["pm_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name: string
          organization_id: string
          status?: Database["public"]["Enums"]["pm_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["pm_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "programs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "programs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_benefits: {
        Row: {
          actual_realization_date: string | null
          actual_value: number | null
          archived_at: string | null
          baseline_value: number | null
          benefit_owner_id: string | null
          benefit_type: string
          created_at: string
          created_by: string | null
          custom_benefit_type_label: string | null
          description: string | null
          evidence_note: string | null
          expected_realization_date: string | null
          id: string
          metric_name: string
          organization_id: string
          project_id: string
          realization_status: string
          target_value: number
          unit_of_measure: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          actual_realization_date?: string | null
          actual_value?: number | null
          archived_at?: string | null
          baseline_value?: number | null
          benefit_owner_id?: string | null
          benefit_type: string
          created_at?: string
          created_by?: string | null
          custom_benefit_type_label?: string | null
          description?: string | null
          evidence_note?: string | null
          expected_realization_date?: string | null
          id?: string
          metric_name: string
          organization_id: string
          project_id: string
          realization_status?: string
          target_value: number
          unit_of_measure: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          actual_realization_date?: string | null
          actual_value?: number | null
          archived_at?: string | null
          baseline_value?: number | null
          benefit_owner_id?: string | null
          benefit_type?: string
          created_at?: string
          created_by?: string | null
          custom_benefit_type_label?: string | null
          description?: string | null
          evidence_note?: string | null
          expected_realization_date?: string | null
          id?: string
          metric_name?: string
          organization_id?: string
          project_id?: string
          realization_status?: string
          target_value?: number
          unit_of_measure?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_benefits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "project_benefits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_benefits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_benefits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_closure_summaries: {
        Row: {
          achievements_summary_encrypted: string | null
          benefits_summary_encrypted: string | null
          created_at: string
          created_by: string | null
          id: string
          open_items_summary_encrypted: string | null
          organization_id: string
          outcome_summary_encrypted: string | null
          project_id: string
          transition_notes_encrypted: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          achievements_summary_encrypted?: string | null
          benefits_summary_encrypted?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          open_items_summary_encrypted?: string | null
          organization_id: string
          outcome_summary_encrypted?: string | null
          project_id: string
          transition_notes_encrypted?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          achievements_summary_encrypted?: string | null
          benefits_summary_encrypted?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          open_items_summary_encrypted?: string | null
          organization_id?: string
          outcome_summary_encrypted?: string | null
          project_id?: string
          transition_notes_encrypted?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_closure_summaries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "project_closure_summaries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_closure_summaries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_closure_summaries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_lessons_learned_documents: {
        Row: {
          created_at: string
          created_by: string | null
          created_in_sharepoint_at: string | null
          document_name_encrypted: string | null
          id: string
          last_modified_at: string | null
          metadata_refreshed_at: string | null
          organization_id: string
          project_id: string
          sharepoint_drive_id_encrypted: string | null
          sharepoint_item_id_encrypted: string | null
          sharepoint_web_url_encrypted: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_in_sharepoint_at?: string | null
          document_name_encrypted?: string | null
          id?: string
          last_modified_at?: string | null
          metadata_refreshed_at?: string | null
          organization_id: string
          project_id: string
          sharepoint_drive_id_encrypted?: string | null
          sharepoint_item_id_encrypted?: string | null
          sharepoint_web_url_encrypted?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_in_sharepoint_at?: string | null
          document_name_encrypted?: string | null
          id?: string
          last_modified_at?: string | null
          metadata_refreshed_at?: string | null
          organization_id?: string
          project_id?: string
          sharepoint_drive_id_encrypted?: string | null
          sharepoint_item_id_encrypted?: string | null
          sharepoint_web_url_encrypted?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_lessons_learned_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "project_lessons_learned_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_lessons_learned_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_lessons_learned_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_memberships: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          project_id: string
          removed_at: string | null
          role: Database["public"]["Enums"]["project_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          project_id: string
          removed_at?: string | null
          role: Database["public"]["Enums"]["project_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          project_id?: string
          removed_at?: string | null
          role?: Database["public"]["Enums"]["project_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_memberships_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_people_preset_members: {
        Row: {
          canonical_role_key: string | null
          created_at: string
          external_name: string | null
          id: string
          member_kind: string
          preset_id: string
          role_label: string | null
          stakeholder_type: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          canonical_role_key?: string | null
          created_at?: string
          external_name?: string | null
          id?: string
          member_kind: string
          preset_id: string
          role_label?: string | null
          stakeholder_type?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          canonical_role_key?: string | null
          created_at?: string
          external_name?: string | null
          id?: string
          member_kind?: string
          preset_id?: string
          role_label?: string | null
          stakeholder_type?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_people_preset_members_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "project_people_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      project_people_presets: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          scope_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          scope_type?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          scope_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_people_presets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "project_people_presets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_people_presets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_stakeholders: {
        Row: {
          created_at: string
          created_by: string | null
          external_name: string | null
          id: string
          notes: string | null
          organization_id: string
          project_id: string
          removed_at: string | null
          removed_by: string | null
          role_label: string | null
          stakeholder_type: string
          start_date: string | null
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          external_name?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          project_id: string
          removed_at?: string | null
          removed_by?: string | null
          role_label?: string | null
          stakeholder_type: string
          start_date?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          external_name?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          project_id?: string
          removed_at?: string | null
          removed_by?: string | null
          role_label?: string | null
          stakeholder_type?: string
          start_date?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_stakeholders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "project_stakeholders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stakeholders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stakeholders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_team_members: {
        Row: {
          canonical_role_key: string | null
          created_at: string
          id: string
          organization_id: string
          project_id: string
          role_label: string | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          canonical_role_key?: string | null
          created_at?: string
          id?: string
          organization_id: string
          project_id: string
          role_label?: string | null
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          canonical_role_key?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          project_id?: string
          role_label?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_team_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "project_team_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_team_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_team_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_templates: {
        Row: {
          blueprint_payload: string
          blueprint_version: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          name: string
          organization_id: string
          source_project_id: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          blueprint_payload: string
          blueprint_version?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name: string
          organization_id: string
          source_project_id?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          blueprint_payload?: string
          blueprint_version?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          organization_id?: string
          source_project_id?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "project_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_templates_source_project_id_fkey"
            columns: ["source_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          actual_end_date: string | null
          actual_start_date: string | null
          agile_enabled: boolean
          assumptions: string | null
          baseline_approved_at: string | null
          baseline_approved_by: string | null
          baseline_end_date: string | null
          baseline_start_date: string | null
          budget_narrative: string | null
          business_case: string | null
          charter: string | null
          completion_criteria: string | null
          constraints: string | null
          created_at: string
          created_by: string | null
          delivery_model:
            | Database["public"]["Enums"]["project_delivery_model"]
            | null
          description: string | null
          goals: string | null
          id: string
          is_archived: boolean
          is_baselined: boolean
          name: string
          organization_id: string
          portfolio_item_id: string | null
          priority: Database["public"]["Enums"]["pm_priority"]
          program_id: string | null
          project_stage: Database["public"]["Enums"]["project_stage"]
          scope_in: string | null
          scope_out: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["pm_status"]
          success_criteria: string | null
          target_end_date: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          agile_enabled?: boolean
          assumptions?: string | null
          baseline_approved_at?: string | null
          baseline_approved_by?: string | null
          baseline_end_date?: string | null
          baseline_start_date?: string | null
          budget_narrative?: string | null
          business_case?: string | null
          charter?: string | null
          completion_criteria?: string | null
          constraints?: string | null
          created_at?: string
          created_by?: string | null
          delivery_model?:
            | Database["public"]["Enums"]["project_delivery_model"]
            | null
          description?: string | null
          goals?: string | null
          id?: string
          is_archived?: boolean
          is_baselined?: boolean
          name: string
          organization_id: string
          portfolio_item_id?: string | null
          priority?: Database["public"]["Enums"]["pm_priority"]
          program_id?: string | null
          project_stage?: Database["public"]["Enums"]["project_stage"]
          scope_in?: string | null
          scope_out?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["pm_status"]
          success_criteria?: string | null
          target_end_date?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          agile_enabled?: boolean
          assumptions?: string | null
          baseline_approved_at?: string | null
          baseline_approved_by?: string | null
          baseline_end_date?: string | null
          baseline_start_date?: string | null
          budget_narrative?: string | null
          business_case?: string | null
          charter?: string | null
          completion_criteria?: string | null
          constraints?: string | null
          created_at?: string
          created_by?: string | null
          delivery_model?:
            | Database["public"]["Enums"]["project_delivery_model"]
            | null
          description?: string | null
          goals?: string | null
          id?: string
          is_archived?: boolean
          is_baselined?: boolean
          name?: string
          organization_id?: string
          portfolio_item_id?: string | null
          priority?: Database["public"]["Enums"]["pm_priority"]
          program_id?: string | null
          project_stage?: Database["public"]["Enums"]["project_stage"]
          scope_in?: string | null
          scope_out?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["pm_status"]
          success_criteria?: string | null
          target_end_date?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_portfolio_item_id_fkey"
            columns: ["portfolio_item_id"]
            isOneToOne: false
            referencedRelation: "portfolio_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      raci_assignments: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          raci_role: Database["public"]["Enums"]["raci_role"]
          stakeholder_id: string | null
          target_id: string
          target_type: string
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          raci_role: Database["public"]["Enums"]["raci_role"]
          stakeholder_id?: string | null
          target_id: string
          target_type: string
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          raci_role?: Database["public"]["Enums"]["raci_role"]
          stakeholder_id?: string | null
          target_id?: string
          target_type?: string
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raci_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "raci_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raci_assignments_stakeholder_id_fkey"
            columns: ["stakeholder_id"]
            isOneToOne: false
            referencedRelation: "project_stakeholders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raci_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      risks: {
        Row: {
          created_at: string
          description: string | null
          id: string
          impact: Database["public"]["Enums"]["pm_priority"]
          likelihood: Database["public"]["Enums"]["risk_likelihood"]
          mitigation_plan: string | null
          organization_id: string
          reported_by: string | null
          status: Database["public"]["Enums"]["risk_status"]
          target_id: string
          target_type: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          impact?: Database["public"]["Enums"]["pm_priority"]
          likelihood?: Database["public"]["Enums"]["risk_likelihood"]
          mitigation_plan?: string | null
          organization_id: string
          reported_by?: string | null
          status?: Database["public"]["Enums"]["risk_status"]
          target_id: string
          target_type: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          impact?: Database["public"]["Enums"]["pm_priority"]
          likelihood?: Database["public"]["Enums"]["risk_likelihood"]
          mitigation_plan?: string | null
          organization_id?: string
          reported_by?: string | null
          status?: Database["public"]["Enums"]["risk_status"]
          target_id?: string
          target_type?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "risks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_story_ai_run_files: {
        Row: {
          ai_run_id: string
          attachment_alias: string
          created_at: string
          external_file_id: string | null
          file_extension: string | null
          id: string
          input_kind: string
          mime_type: string | null
          sha256: string | null
          size_bytes: number | null
          skip_reason: string | null
          status: string
          story_pack_id: string
        }
        Insert: {
          ai_run_id: string
          attachment_alias: string
          created_at?: string
          external_file_id?: string | null
          file_extension?: string | null
          id?: string
          input_kind: string
          mime_type?: string | null
          sha256?: string | null
          size_bytes?: number | null
          skip_reason?: string | null
          status: string
          story_pack_id: string
        }
        Update: {
          ai_run_id?: string
          attachment_alias?: string
          created_at?: string
          external_file_id?: string | null
          file_extension?: string | null
          id?: string
          input_kind?: string
          mime_type?: string | null
          sha256?: string | null
          size_bytes?: number | null
          skip_reason?: string | null
          status?: string
          story_pack_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_story_ai_run_files_ai_run_id_fkey"
            columns: ["ai_run_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_ai_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_ai_run_files_external_file_id_fkey"
            columns: ["external_file_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_pack_external_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_ai_run_files_story_pack_id_fkey"
            columns: ["story_pack_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_story_ai_runs: {
        Row: {
          completed_at: string | null
          completion_tokens: number | null
          cost_usd: number | null
          created_at: string
          created_by: string
          error_text_encrypted: string | null
          feature_key: string
          files_selected_count: number
          files_sent_count: number
          files_skipped_count: number
          id: string
          input_manifest: Json
          model: string | null
          openai_response_id: string | null
          output_text_encrypted: string | null
          prompt_summary_encrypted: string | null
          prompt_tokens: number | null
          provider: string | null
          reasoning_effort: string | null
          source_snapshot_encrypted: string | null
          started_at: string | null
          status: string
          story_pack_id: string
          story_pack_version_id: string | null
          total_bytes_sent: number
          total_tokens: number | null
        }
        Insert: {
          completed_at?: string | null
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          created_by: string
          error_text_encrypted?: string | null
          feature_key?: string
          files_selected_count?: number
          files_sent_count?: number
          files_skipped_count?: number
          id?: string
          input_manifest?: Json
          model?: string | null
          openai_response_id?: string | null
          output_text_encrypted?: string | null
          prompt_summary_encrypted?: string | null
          prompt_tokens?: number | null
          provider?: string | null
          reasoning_effort?: string | null
          source_snapshot_encrypted?: string | null
          started_at?: string | null
          status?: string
          story_pack_id: string
          story_pack_version_id?: string | null
          total_bytes_sent?: number
          total_tokens?: number | null
        }
        Update: {
          completed_at?: string | null
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          created_by?: string
          error_text_encrypted?: string | null
          feature_key?: string
          files_selected_count?: number
          files_sent_count?: number
          files_skipped_count?: number
          id?: string
          input_manifest?: Json
          model?: string | null
          openai_response_id?: string | null
          output_text_encrypted?: string | null
          prompt_summary_encrypted?: string | null
          prompt_tokens?: number | null
          provider?: string | null
          reasoning_effort?: string | null
          source_snapshot_encrypted?: string | null
          started_at?: string | null
          status?: string
          story_pack_id?: string
          story_pack_version_id?: string | null
          total_bytes_sent?: number
          total_tokens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_story_ai_runs_story_pack_id_fkey"
            columns: ["story_pack_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_ai_runs_story_pack_version_id_fkey"
            columns: ["story_pack_version_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_pack_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_story_pack_external_files: {
        Row: {
          created_at: string
          created_by: string
          display_name_encrypted: string | null
          drive_id: string | null
          id: string
          include_in_story: boolean
          item_id: string | null
          mime_type: string | null
          provider: string
          size_bytes: number | null
          story_pack_id: string
          updated_at: string
          user_note_encrypted: string | null
          web_url_encrypted: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          display_name_encrypted?: string | null
          drive_id?: string | null
          id?: string
          include_in_story?: boolean
          item_id?: string | null
          mime_type?: string | null
          provider?: string
          size_bytes?: number | null
          story_pack_id: string
          updated_at?: string
          user_note_encrypted?: string | null
          web_url_encrypted?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          display_name_encrypted?: string | null
          drive_id?: string | null
          id?: string
          include_in_story?: boolean
          item_id?: string | null
          mime_type?: string | null
          provider?: string
          size_bytes?: number | null
          story_pack_id?: string
          updated_at?: string
          user_note_encrypted?: string | null
          web_url_encrypted?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_story_pack_external_files_story_pack_id_fkey"
            columns: ["story_pack_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_story_pack_notes: {
        Row: {
          body_encrypted: string
          created_at: string
          created_by: string
          id: string
          include_in_story: boolean
          label_encrypted: string | null
          sort_order: number | null
          story_pack_id: string
          updated_at: string
        }
        Insert: {
          body_encrypted: string
          created_at?: string
          created_by: string
          id?: string
          include_in_story?: boolean
          label_encrypted?: string | null
          sort_order?: number | null
          story_pack_id: string
          updated_at?: string
        }
        Update: {
          body_encrypted?: string
          created_at?: string
          created_by?: string
          id?: string
          include_in_story?: boolean
          label_encrypted?: string | null
          sort_order?: number | null
          story_pack_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_story_pack_notes_story_pack_id_fkey"
            columns: ["story_pack_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_story_pack_presentation_runs: {
        Row: {
          completed_at: string | null
          completion_tokens: number | null
          created_at: string
          created_by: string
          error_text_encrypted: string | null
          feature_key: string
          id: string
          input_manifest: Json
          input_package_encrypted: string | null
          is_valid: boolean | null
          model: string | null
          model_metadata: Json
          openai_response_id: string | null
          parsed_blueprint_encrypted: string | null
          prompt_encrypted: string | null
          prompt_tokens: number | null
          provider: string | null
          raw_response_encrypted: string | null
          reasoning_effort: string | null
          started_at: string | null
          status: string
          story_pack_id: string
          story_pack_version_id: string | null
          total_tokens: number | null
          validation_json_encrypted: string | null
        }
        Insert: {
          completed_at?: string | null
          completion_tokens?: number | null
          created_at?: string
          created_by: string
          error_text_encrypted?: string | null
          feature_key?: string
          id?: string
          input_manifest?: Json
          input_package_encrypted?: string | null
          is_valid?: boolean | null
          model?: string | null
          model_metadata?: Json
          openai_response_id?: string | null
          parsed_blueprint_encrypted?: string | null
          prompt_encrypted?: string | null
          prompt_tokens?: number | null
          provider?: string | null
          raw_response_encrypted?: string | null
          reasoning_effort?: string | null
          started_at?: string | null
          status?: string
          story_pack_id: string
          story_pack_version_id?: string | null
          total_tokens?: number | null
          validation_json_encrypted?: string | null
        }
        Update: {
          completed_at?: string | null
          completion_tokens?: number | null
          created_at?: string
          created_by?: string
          error_text_encrypted?: string | null
          feature_key?: string
          id?: string
          input_manifest?: Json
          input_package_encrypted?: string | null
          is_valid?: boolean | null
          model?: string | null
          model_metadata?: Json
          openai_response_id?: string | null
          parsed_blueprint_encrypted?: string | null
          prompt_encrypted?: string | null
          prompt_tokens?: number | null
          provider?: string | null
          raw_response_encrypted?: string | null
          reasoning_effort?: string | null
          started_at?: string | null
          status?: string
          story_pack_id?: string
          story_pack_version_id?: string | null
          total_tokens?: number | null
          validation_json_encrypted?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_story_pack_presentation_runs_story_pack_id_fkey"
            columns: ["story_pack_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_pack_presentation_runs_story_pack_version_id_fkey"
            columns: ["story_pack_version_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_pack_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_story_pack_sources: {
        Row: {
          config: Json
          created_at: string
          id: string
          is_enabled: boolean
          sort_order: number | null
          source_category: string
          story_pack_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          is_enabled?: boolean
          sort_order?: number | null
          source_category: string
          story_pack_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          is_enabled?: boolean
          sort_order?: number | null
          source_category?: string
          story_pack_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_story_pack_sources_story_pack_id_fkey"
            columns: ["story_pack_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_story_pack_versions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          model_metadata: Json
          source_manifest: Json
          source_snapshot_encrypted: string | null
          status: string
          story_json_encrypted: string | null
          story_pack_id: string
          version_number: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          model_metadata?: Json
          source_manifest?: Json
          source_snapshot_encrypted?: string | null
          status?: string
          story_json_encrypted?: string | null
          story_pack_id: string
          version_number: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          model_metadata?: Json
          source_manifest?: Json
          source_snapshot_encrypted?: string | null
          status?: string
          story_json_encrypted?: string | null
          story_pack_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_story_pack_versions_story_pack_id_fkey"
            columns: ["story_pack_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_story_packs: {
        Row: {
          audience: string | null
          created_at: string
          created_by: string
          focus: string | null
          id: string
          organization_id: string
          primary_workspace_id: string | null
          program_id: string | null
          scope_config: Json
          source_config: Json
          status: string
          title_encrypted: string | null
          updated_at: string
          user_guidance_encrypted: string | null
          visual_settings: Json | null
        }
        Insert: {
          audience?: string | null
          created_at?: string
          created_by: string
          focus?: string | null
          id?: string
          organization_id: string
          primary_workspace_id?: string | null
          program_id?: string | null
          scope_config?: Json
          source_config?: Json
          status?: string
          title_encrypted?: string | null
          updated_at?: string
          user_guidance_encrypted?: string | null
          visual_settings?: Json | null
        }
        Update: {
          audience?: string | null
          created_at?: string
          created_by?: string
          focus?: string | null
          id?: string
          organization_id?: string
          primary_workspace_id?: string | null
          program_id?: string | null
          scope_config?: Json
          source_config?: Json
          status?: string
          title_encrypted?: string | null
          updated_at?: string
          user_guidance_encrypted?: string | null
          visual_settings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_story_packs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "roadmap_story_packs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_packs_primary_workspace_id_fkey"
            columns: ["primary_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_packs_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_story_presentation_version_projects: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          presentation_version_id: string
          project_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          presentation_version_id: string
          project_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          presentation_version_id?: string
          project_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_story_presentation_version_presentation_version_id_fkey"
            columns: ["presentation_version_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_presentation_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_presentation_version_project_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "roadmap_story_presentation_version_project_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_presentation_version_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_presentation_version_projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_story_presentation_versions: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          organization_id: string
          presentation_blueprint_run_id: string | null
          presentation_id: string
          published_at: string
          published_by: string
          snapshot_encrypted: string
          source_limitations_encrypted: string | null
          status: string
          story_pack_id: string
          story_pack_version_id: string | null
          title_encrypted: string
          version_number: number
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          organization_id: string
          presentation_blueprint_run_id?: string | null
          presentation_id: string
          published_at?: string
          published_by: string
          snapshot_encrypted: string
          source_limitations_encrypted?: string | null
          status?: string
          story_pack_id: string
          story_pack_version_id?: string | null
          title_encrypted: string
          version_number: number
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          presentation_blueprint_run_id?: string | null
          presentation_id?: string
          published_at?: string
          published_by?: string
          snapshot_encrypted?: string
          source_limitations_encrypted?: string | null
          status?: string
          story_pack_id?: string
          story_pack_version_id?: string | null
          title_encrypted?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_story_presentation_ve_presentation_blueprint_run_i_fkey"
            columns: ["presentation_blueprint_run_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_pack_presentation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_presentation_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "roadmap_story_presentation_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_presentation_versions_presentation_id_fkey"
            columns: ["presentation_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_presentations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_presentation_versions_story_pack_id_fkey"
            columns: ["story_pack_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_presentation_versions_story_pack_version_id_fkey"
            columns: ["story_pack_version_id"]
            isOneToOne: false
            referencedRelation: "roadmap_story_pack_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_story_presentations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          organization_id: string
          status: string
          story_pack_id: string
          title_encrypted: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          status?: string
          story_pack_id: string
          title_encrypted: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          status?: string
          story_pack_id?: string
          title_encrypted?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_story_presentations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "roadmap_story_presentations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_story_presentations_story_pack_id_fkey"
            columns: ["story_pack_id"]
            isOneToOne: true
            referencedRelation: "roadmap_story_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      sharepoint_org_site_connections: {
        Row: {
          connection_status: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          id: string
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          managed_outside_btpm: boolean
          organization_id: string
          site_id: string | null
          site_label_or_name: string | null
          site_web_url: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          connection_status?: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          id?: string
          last_validated_at?: string | null
          last_validation_code?: string | null
          last_validation_note?: string | null
          managed_outside_btpm?: boolean
          organization_id: string
          site_id?: string | null
          site_label_or_name?: string | null
          site_web_url: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          connection_status?: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          id?: string
          last_validated_at?: string | null
          last_validation_code?: string | null
          last_validation_note?: string | null
          managed_outside_btpm?: boolean
          organization_id?: string
          site_id?: string | null
          site_label_or_name?: string | null
          site_web_url?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      sharepoint_project_bindings: {
        Row: {
          binding_mode: Database["public"]["Enums"]["sharepoint_project_binding_mode"]
          binding_status: Database["public"]["Enums"]["sharepoint_project_binding_status"]
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          folder_item_id: string | null
          folder_relative_path: string | null
          folder_web_url: string
          id: string
          is_restricted: boolean
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          organization_id: string
          project_id: string
          resolved_library_id_or_drive_id: string | null
          resolved_library_web_url: string | null
          resolved_site_id: string | null
          resolved_site_web_url: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
          workspace_sharepoint_binding_id: string | null
        }
        Insert: {
          binding_mode?: Database["public"]["Enums"]["sharepoint_project_binding_mode"]
          binding_status?: Database["public"]["Enums"]["sharepoint_project_binding_status"]
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          folder_item_id?: string | null
          folder_relative_path?: string | null
          folder_web_url: string
          id?: string
          is_restricted?: boolean
          last_validated_at?: string | null
          last_validation_code?: string | null
          last_validation_note?: string | null
          organization_id: string
          project_id: string
          resolved_library_id_or_drive_id?: string | null
          resolved_library_web_url?: string | null
          resolved_site_id?: string | null
          resolved_site_web_url?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
          workspace_sharepoint_binding_id?: string | null
        }
        Update: {
          binding_mode?: Database["public"]["Enums"]["sharepoint_project_binding_mode"]
          binding_status?: Database["public"]["Enums"]["sharepoint_project_binding_status"]
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          folder_item_id?: string | null
          folder_relative_path?: string | null
          folder_web_url?: string
          id?: string
          is_restricted?: boolean
          last_validated_at?: string | null
          last_validation_code?: string | null
          last_validation_note?: string | null
          organization_id?: string
          project_id?: string
          resolved_library_id_or_drive_id?: string | null
          resolved_library_web_url?: string | null
          resolved_site_id?: string | null
          resolved_site_web_url?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
          workspace_sharepoint_binding_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sharepoint_project_bindings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sharepoint_project_bindings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sharepoint_project_bindings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sharepoint_project_bindings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sharepoint_project_bindings_workspace_sharepoint_binding_i_fkey"
            columns: ["workspace_sharepoint_binding_id"]
            isOneToOne: false
            referencedRelation: "sharepoint_workspace_bindings"
            referencedColumns: ["id"]
          },
        ]
      }
      sharepoint_workspace_bindings: {
        Row: {
          binding_status: Database["public"]["Enums"]["sharepoint_workspace_binding_status"]
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          id: string
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          library_id_or_drive_id: string | null
          library_label_or_name: string | null
          library_web_url: string
          managed_outside_btpm: boolean
          organization_id: string
          site_id: string | null
          site_label_or_name: string | null
          site_web_url: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          binding_status?: Database["public"]["Enums"]["sharepoint_workspace_binding_status"]
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          id?: string
          last_validated_at?: string | null
          last_validation_code?: string | null
          last_validation_note?: string | null
          library_id_or_drive_id?: string | null
          library_label_or_name?: string | null
          library_web_url: string
          managed_outside_btpm?: boolean
          organization_id: string
          site_id?: string | null
          site_label_or_name?: string | null
          site_web_url: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          binding_status?: Database["public"]["Enums"]["sharepoint_workspace_binding_status"]
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          id?: string
          last_validated_at?: string | null
          last_validation_code?: string | null
          last_validation_note?: string | null
          library_id_or_drive_id?: string | null
          library_label_or_name?: string | null
          library_web_url?: string
          managed_outside_btpm?: boolean
          organization_id?: string
          site_id?: string | null
          site_label_or_name?: string | null
          site_web_url?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sharepoint_workspace_bindings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sharepoint_workspace_bindings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sharepoint_workspace_bindings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sprints: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string | null
          goal: string | null
          id: string
          is_archived: boolean
          name: string
          organization_id: string
          project_id: string
          sort_order: number
          start_date: string | null
          status: Database["public"]["Enums"]["sprint_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          is_archived?: boolean
          name: string
          organization_id: string
          project_id: string
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["sprint_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          organization_id?: string
          project_id?: string
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["sprint_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sprints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sprints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprints_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprints_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignments: {
        Row: {
          assigned_by: string | null
          assignee_id: string
          created_at: string
          id: string
          organization_id: string
          task_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_by?: string | null
          assignee_id: string
          created_at?: string
          id?: string
          organization_id: string
          task_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assigned_by?: string | null
          assignee_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          task_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "task_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_stakeholder_roles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          project_stakeholder_id: string
          role_type: Database["public"]["Enums"]["task_stakeholder_role_type"]
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          project_stakeholder_id: string
          role_type: Database["public"]["Enums"]["task_stakeholder_role_type"]
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          project_stakeholder_id?: string
          role_type?: Database["public"]["Enums"]["task_stakeholder_role_type"]
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_stakeholder_roles_project_stakeholder_id_fkey"
            columns: ["project_stakeholder_id"]
            isOneToOne: false
            referencedRelation: "project_stakeholders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_stakeholder_roles_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          actual_end_date: string | null
          actual_start_date: string | null
          added_after_baseline: boolean
          adoption_initiative_id: string | null
          backlog_item_id: string | null
          baseline_end_date: string | null
          baseline_start_date: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          estimated_hours: number | null
          id: string
          is_adoption_related: boolean
          is_archived: boolean
          name: string
          organization_id: string
          owner_id: string | null
          phase_id: string
          priority: Database["public"]["Enums"]["pm_priority"]
          project_id: string
          sort_order: number
          start_date: string | null
          status: Database["public"]["Enums"]["pm_status"]
          task_type: Database["public"]["Enums"]["task_type"]
          updated_at: string
          workflow_state_id: string | null
          workspace_id: string
        }
        Insert: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          added_after_baseline?: boolean
          adoption_initiative_id?: string | null
          backlog_item_id?: string | null
          baseline_end_date?: string | null
          baseline_start_date?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          is_adoption_related?: boolean
          is_archived?: boolean
          name: string
          organization_id: string
          owner_id?: string | null
          phase_id: string
          priority?: Database["public"]["Enums"]["pm_priority"]
          project_id: string
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["pm_status"]
          task_type?: Database["public"]["Enums"]["task_type"]
          updated_at?: string
          workflow_state_id?: string | null
          workspace_id: string
        }
        Update: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          added_after_baseline?: boolean
          adoption_initiative_id?: string | null
          backlog_item_id?: string | null
          baseline_end_date?: string | null
          baseline_start_date?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          is_adoption_related?: boolean
          is_archived?: boolean
          name?: string
          organization_id?: string
          owner_id?: string | null
          phase_id?: string
          priority?: Database["public"]["Enums"]["pm_priority"]
          project_id?: string
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["pm_status"]
          task_type?: Database["public"]["Enums"]["task_type"]
          updated_at?: string
          workflow_state_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_adoption_initiative_id_fkey"
            columns: ["adoption_initiative_id"]
            isOneToOne: false
            referencedRelation: "adoption_initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_backlog_item_id_fkey"
            columns: ["backlog_item_id"]
            isOneToOne: false
            referencedRelation: "backlog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workflow_state_id_fkey"
            columns: ["workflow_state_id"]
            isOneToOne: false
            referencedRelation: "board_workflow_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_ai_provider_settings: {
        Row: {
          active_provider: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active_provider?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active_provider?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_ai_provider_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_ai_provider_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_background_jobs: {
        Row: {
          attempt_count: number
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          failed_at: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          last_error: string | null
          max_attempts: number
          not_before: string | null
          organization_id: string | null
          payload: Json
          priority: number
          requested_by: string | null
          result: Json | null
          run_as_user_id: string | null
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          attempt_count?: number
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          failed_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type: string
          last_error?: string | null
          max_attempts?: number
          not_before?: string | null
          organization_id?: string | null
          payload?: Json
          priority?: number
          requested_by?: string | null
          result?: Json | null
          run_as_user_id?: string | null
          started_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          attempt_count?: number
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          failed_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type?: string
          last_error?: string | null
          max_attempts?: number
          not_before?: string | null
          organization_id?: string | null
          payload?: Json
          priority?: number
          requested_by?: string | null
          result?: Json | null
          run_as_user_id?: string | null
          started_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_background_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenant_background_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_background_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_background_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_background_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_encryption_keys: {
        Row: {
          created_at: string
          id: string
          key_provider: string
          key_scope: string
          key_status: string
          key_version: number
          last_rotated_at: string | null
          metadata: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_provider?: string
          key_scope?: string
          key_status?: string
          key_version?: number
          last_rotated_at?: string | null
          metadata?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          key_provider?: string
          key_scope?: string
          key_status?: string
          key_version?: number
          last_rotated_at?: string | null
          metadata?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_encryption_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_encryption_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_encryption_migration_field_batches: {
        Row: {
          batch_cursor: Json
          batch_number: number
          column_name: string
          completed_at: string | null
          created_at: string
          domain_area: string
          id: string
          organization_id: string | null
          primary_key_column: string
          rows_failed: number
          rows_migrated: number
          rows_scanned: number
          rows_skipped_null: number
          rows_skipped_tenant_versioned: number
          run_id: string
          safe_error_code: string | null
          safe_metadata: Json
          started_at: string | null
          status: string
          table_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          batch_cursor?: Json
          batch_number: number
          column_name: string
          completed_at?: string | null
          created_at?: string
          domain_area: string
          id?: string
          organization_id?: string | null
          primary_key_column: string
          rows_failed?: number
          rows_migrated?: number
          rows_scanned?: number
          rows_skipped_null?: number
          rows_skipped_tenant_versioned?: number
          run_id: string
          safe_error_code?: string | null
          safe_metadata?: Json
          started_at?: string | null
          status?: string
          table_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          batch_cursor?: Json
          batch_number?: number
          column_name?: string
          completed_at?: string | null
          created_at?: string
          domain_area?: string
          id?: string
          organization_id?: string | null
          primary_key_column?: string
          rows_failed?: number
          rows_migrated?: number
          rows_scanned?: number
          rows_skipped_null?: number
          rows_skipped_tenant_versioned?: number
          run_id?: string
          safe_error_code?: string | null
          safe_metadata?: Json
          started_at?: string | null
          status?: string
          table_name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_encryption_migration_field_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenant_encryption_migration_field_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_encryption_migration_field_batches_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_migration_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_encryption_migration_field_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_encryption_migration_field_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_encryption_migration_row_checkpoints: {
        Row: {
          attempt_count: number
          batch_id: string
          column_name: string
          completed_at: string | null
          created_at: string
          id: string
          last_attempt_at: string | null
          organization_id: string | null
          row_locator: Json
          run_id: string
          safe_error_code: string | null
          safe_metadata: Json
          status: string
          table_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          batch_id: string
          column_name: string
          completed_at?: string | null
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          organization_id?: string | null
          row_locator: Json
          run_id: string
          safe_error_code?: string | null
          safe_metadata?: Json
          status?: string
          table_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          batch_id?: string
          column_name?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          organization_id?: string | null
          row_locator?: Json
          run_id?: string
          safe_error_code?: string | null
          safe_metadata?: Json
          status?: string
          table_name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_encryption_migration_row_checkpoint_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenant_encryption_migration_row_checkpoint_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_encryption_migration_row_checkpoints_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_migration_field_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_encryption_migration_row_checkpoints_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_migration_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_encryption_migration_row_checkpoints_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_encryption_migration_row_checkpoints_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_encryption_migration_runs: {
        Row: {
          blocker_count: number
          completed_at: string | null
          created_at: string
          dry_run_only: boolean
          id: string
          initiated_by: string | null
          paused_at: string | null
          safe_error_code: string | null
          safe_metadata: Json
          source_model: string
          started_at: string | null
          status: string
          target_key_version: number | null
          target_model: string
          tenant_id: string
          total_fields_planned: number
          total_rows_failed: number
          total_rows_migrated: number
          total_rows_planned: number
          total_rows_scanned: number
          total_rows_skipped_null: number
          total_rows_skipped_tenant_versioned: number
          updated_at: string
        }
        Insert: {
          blocker_count?: number
          completed_at?: string | null
          created_at?: string
          dry_run_only?: boolean
          id?: string
          initiated_by?: string | null
          paused_at?: string | null
          safe_error_code?: string | null
          safe_metadata?: Json
          source_model: string
          started_at?: string | null
          status?: string
          target_key_version?: number | null
          target_model: string
          tenant_id: string
          total_fields_planned?: number
          total_rows_failed?: number
          total_rows_migrated?: number
          total_rows_planned?: number
          total_rows_scanned?: number
          total_rows_skipped_null?: number
          total_rows_skipped_tenant_versioned?: number
          updated_at?: string
        }
        Update: {
          blocker_count?: number
          completed_at?: string | null
          created_at?: string
          dry_run_only?: boolean
          id?: string
          initiated_by?: string | null
          paused_at?: string | null
          safe_error_code?: string | null
          safe_metadata?: Json
          source_model?: string
          started_at?: string | null
          status?: string
          target_key_version?: number | null
          target_model?: string
          tenant_id?: string
          total_fields_planned?: number
          total_rows_failed?: number
          total_rows_migrated?: number
          total_rows_planned?: number
          total_rows_scanned?: number
          total_rows_skipped_null?: number
          total_rows_skipped_tenant_versioned?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_encryption_migration_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_encryption_migration_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_export_packages: {
        Row: {
          completed_at: string | null
          error_message: string | null
          export_type: string
          failed_at: string | null
          id: string
          metadata: Json
          organization_id: string
          requested_at: string
          requested_by: string | null
          source_object_id: string | null
          source_object_type: string | null
          status: string
          storage_object_id: string | null
          tenant_id: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          export_type: string
          failed_at?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          requested_at?: string
          requested_by?: string | null
          source_object_id?: string | null
          source_object_type?: string | null
          status?: string
          storage_object_id?: string | null
          tenant_id: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          export_type?: string
          failed_at?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          requested_at?: string
          requested_by?: string | null
          source_object_id?: string | null
          source_object_type?: string | null
          status?: string
          storage_object_id?: string | null
          tenant_id?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_export_packages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenant_export_packages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_export_packages_storage_object_id_fkey"
            columns: ["storage_object_id"]
            isOneToOne: false
            referencedRelation: "tenant_storage_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_export_packages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_export_packages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_export_packages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_import_temp_objects: {
        Row: {
          expires_at: string | null
          id: string
          import_type: string
          metadata: Json
          organization_id: string
          status: string
          storage_object_id: string | null
          tenant_id: string
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          workspace_id: string | null
        }
        Insert: {
          expires_at?: string | null
          id?: string
          import_type: string
          metadata?: Json
          organization_id: string
          status?: string
          storage_object_id?: string | null
          tenant_id: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          workspace_id?: string | null
        }
        Update: {
          expires_at?: string | null
          id?: string
          import_type?: string
          metadata?: Json
          organization_id?: string
          status?: string
          storage_object_id?: string | null
          tenant_id?: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_import_temp_objects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenant_import_temp_objects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_import_temp_objects_storage_object_id_fkey"
            columns: ["storage_object_id"]
            isOneToOne: false
            referencedRelation: "tenant_storage_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_import_temp_objects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_import_temp_objects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_import_temp_objects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_integrations: {
        Row: {
          config_metadata: Json
          created_at: string
          created_by: string | null
          id: string
          is_enabled: boolean
          kind: Database["public"]["Enums"]["tenant_integration_kind"]
          last_error_at: string | null
          last_error_message: string | null
          last_success_at: string | null
          last_tested_at: string | null
          name: string
          status: Database["public"]["Enums"]["tenant_integration_status"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config_metadata?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_enabled?: boolean
          kind: Database["public"]["Enums"]["tenant_integration_kind"]
          last_error_at?: string | null
          last_error_message?: string | null
          last_success_at?: string | null
          last_tested_at?: string | null
          name: string
          status?: Database["public"]["Enums"]["tenant_integration_status"]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config_metadata?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_enabled?: boolean
          kind?: Database["public"]["Enums"]["tenant_integration_kind"]
          last_error_at?: string | null
          last_error_message?: string | null
          last_success_at?: string | null
          last_tested_at?: string | null
          name?: string
          status?: Database["public"]["Enums"]["tenant_integration_status"]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          deactivation_reason: string | null
          id: string
          role: Database["public"]["Enums"]["tenant_role"]
          status: Database["public"]["Enums"]["membership_status"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_scheduler_runs: {
        Row: {
          completed_at: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          jobs_enqueued: number
          metadata: Json
          scheduler_name: string
          started_at: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          jobs_enqueued?: number
          metadata?: Json
          scheduler_name: string
          started_at?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          jobs_enqueued?: number
          metadata?: Json
          scheduler_name?: string
          started_at?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_scheduler_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_scheduler_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_secret_access_audit: {
        Row: {
          action: Database["public"]["Enums"]["tenant_secret_audit_action"]
          actor_type: string
          actor_user_id: string | null
          created_at: string
          error_message: string | null
          function_name: string | null
          id: string
          integration_id: string | null
          organization_id: string | null
          reason: string | null
          request_id: string | null
          result: string
          secret_ref_id: string | null
          tenant_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["tenant_secret_audit_action"]
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          error_message?: string | null
          function_name?: string | null
          id?: string
          integration_id?: string | null
          organization_id?: string | null
          reason?: string | null
          request_id?: string | null
          result?: string
          secret_ref_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["tenant_secret_audit_action"]
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          error_message?: string | null
          function_name?: string | null
          id?: string
          integration_id?: string | null
          organization_id?: string | null
          reason?: string | null
          request_id?: string | null
          result?: string
          secret_ref_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_secret_access_audit_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "tenant_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_secret_access_audit_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenant_secret_access_audit_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_secret_access_audit_secret_ref_id_fkey"
            columns: ["secret_ref_id"]
            isOneToOne: false
            referencedRelation: "tenant_secret_refs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_secret_access_audit_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_secret_access_audit_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_secret_refs: {
        Row: {
          created_at: string
          created_by: string | null
          disabled_at: string | null
          id: string
          integration_id: string
          organization_id: string | null
          revoked_at: string | null
          rotated_at: string | null
          secret_fingerprint: string | null
          secret_kind: string
          secret_name: string
          secret_scope: Database["public"]["Enums"]["tenant_secret_scope"]
          status: Database["public"]["Enums"]["tenant_secret_status"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vault_secret_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          id?: string
          integration_id: string
          organization_id?: string | null
          revoked_at?: string | null
          rotated_at?: string | null
          secret_fingerprint?: string | null
          secret_kind: string
          secret_name: string
          secret_scope?: Database["public"]["Enums"]["tenant_secret_scope"]
          status?: Database["public"]["Enums"]["tenant_secret_status"]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vault_secret_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          id?: string
          integration_id?: string
          organization_id?: string | null
          revoked_at?: string | null
          rotated_at?: string | null
          secret_fingerprint?: string | null
          secret_kind?: string
          secret_name?: string
          secret_scope?: Database["public"]["Enums"]["tenant_secret_scope"]
          status?: Database["public"]["Enums"]["tenant_secret_status"]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vault_secret_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_secret_refs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "tenant_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_secret_refs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenant_secret_refs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_secret_refs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_secret_refs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_storage_objects: {
        Row: {
          bucket: string
          checksum: string | null
          content_type: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          file_name: string
          id: string
          legacy_object_path: string | null
          metadata: Json
          object_id: string | null
          object_path: string
          object_type: string
          organization_id: string
          size_bytes: number | null
          storage_status: string
          surface: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string | null
        }
        Insert: {
          bucket: string
          checksum?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          file_name: string
          id?: string
          legacy_object_path?: string | null
          metadata?: Json
          object_id?: string | null
          object_path: string
          object_type: string
          organization_id: string
          size_bytes?: number | null
          storage_status?: string
          surface: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string | null
        }
        Update: {
          bucket?: string
          checksum?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          file_name?: string
          id?: string
          legacy_object_path?: string | null
          metadata?: Json
          object_id?: string | null
          object_path?: string
          object_type?: string
          organization_id?: string
          size_bytes?: number | null
          storage_status?: string
          surface?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_storage_objects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenant_storage_objects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_storage_objects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_storage_objects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_storage_objects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          default_organization_id: string | null
          deletion_requested_at: string | null
          deletion_requested_by: string | null
          id: string
          legal_hold: boolean
          metadata: Json
          name: string
          purged_at: string | null
          retained_at: string | null
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          suspended_at: string | null
          suspended_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          default_organization_id?: string | null
          deletion_requested_at?: string | null
          deletion_requested_by?: string | null
          id?: string
          legal_hold?: boolean
          metadata?: Json
          name: string
          purged_at?: string | null
          retained_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          suspended_at?: string | null
          suspended_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          default_organization_id?: string | null
          deletion_requested_at?: string | null
          deletion_requested_by?: string | null
          id?: string
          legal_hold?: boolean
          metadata?: Json
          name?: string
          purged_at?: string | null
          retained_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          suspended_at?: string | null
          suspended_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenants_default_organization_fk"
            columns: ["default_organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "tenants_default_organization_fk"
            columns: ["default_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_active_context_preferences: {
        Row: {
          is_all_workspaces: boolean
          last_active_organization_id: string | null
          last_active_tenant_id: string | null
          last_active_workspace_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          is_all_workspaces?: boolean
          last_active_organization_id?: string | null
          last_active_tenant_id?: string | null
          last_active_workspace_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          is_all_workspaces?: boolean
          last_active_organization_id?: string | null
          last_active_tenant_id?: string | null
          last_active_workspace_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_active_context_preference_last_active_organization_id_fkey"
            columns: ["last_active_organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "user_active_context_preference_last_active_organization_id_fkey"
            columns: ["last_active_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_active_context_preferences_last_active_tenant_id_fkey"
            columns: ["last_active_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "user_active_context_preferences_last_active_tenant_id_fkey"
            columns: ["last_active_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_active_context_preferences_last_active_workspace_id_fkey"
            columns: ["last_active_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_saved_views: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          scope_key: string
          state_payload: string
          surface_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          scope_key?: string
          state_payload: string
          surface_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          scope_key?: string
          state_payload?: string
          surface_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workspace_memberships: {
        Row: {
          created_at: string
          id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_archived: boolean
          is_demo: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_archived?: boolean
          is_demo?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_archived?: boolean
          is_demo?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organization_encryption_posture"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "workspaces_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      organization_encryption_posture: {
        Row: {
          encryption_model: string | null
          environment_role:
            | Database["public"]["Enums"]["environment_role"]
            | null
          is_production: boolean | null
          key_scope: string | null
          key_status: string | null
          last_rotated_at: string | null
          legacy_org_key_name_present: boolean | null
          organization_id: string | null
          organization_name: string | null
          tenant_id: string | null
          warnings: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_encryption_posture"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "organizations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_encryption_posture: {
        Row: {
          active_tenant_key_status: string | null
          active_tenant_key_version: number | null
          business_record_reencryption_performed: boolean | null
          final_fields_scanned: number | null
          final_legacy_remaining: number | null
          final_malformed_remaining: number | null
          final_tenant_versioned_populated: number | null
          final_tenant_versioned_unreadable: number | null
          final_verification_passed: boolean | null
          high_gap_count: number | null
          legacy_key_retirement_action_status: string | null
          legacy_key_retirement_readiness: string | null
          legacy_org_keys_retained: boolean | null
          model_status: string | null
          non_production_org_count: number | null
          organization_count: number | null
          organizations_missing_metadata: number | null
          organizations_with_metadata: number | null
          production_org_count: number | null
          retained_legacy_org_key_count: number | null
          runtime_caller_migration_active: boolean | null
          runtime_model: string | null
          tenant_id: string | null
          tenant_key_payload_format_ready: boolean | null
          tenant_key_provider: string | null
          tenant_key_scope: string | null
          tenant_key_status: string | null
          tenant_key_v1_block_reason_code: string | null
          tenant_key_v1_import_blocked: boolean | null
          tenant_key_v1_imported: boolean | null
          tenant_key_v1_status: string | null
          tenant_key_version: number | null
          tenant_last_rotated_at: string | null
          tenant_name: string | null
          updated_at: string | null
          warning_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _actual_rollup_allowed: { Args: never; Returns: boolean }
      _adoption_template_validate_and_load: {
        Args: {
          _organization_id: string
          _payload: Json
          _template_id: string
          _workspace_id: string
        }
        Returns: undefined
      }
      _apply_phase_extension_internal: {
        Args: {
          _new_end: string
          _new_start: string
          _phase_id: string
          _trigger_id: string
          _trigger_kind: string
        }
        Returns: undefined
      }
      _apply_project_extension_internal: {
        Args: {
          _new_end: string
          _new_start: string
          _project_id: string
          _trigger_id: string
          _trigger_kind: string
        }
        Returns: undefined
      }
      _assert_admin: {
        Args: { _organization_id: string; _workspace_id: string }
        Returns: undefined
      }
      _assert_job_payload_no_secret_keys: {
        Args: { _payload: Json }
        Returns: undefined
      }
      _assert_pm_or_admin: {
        Args: { _organization_id: string; _workspace_id: string }
        Returns: undefined
      }
      _assert_tenant_admin_caller: {
        Args: { _tenant_id: string }
        Returns: undefined
      }
      _assert_tenant_admin_or_super: {
        Args: { _reason: string; _tenant_id: string }
        Returns: undefined
      }
      _azure_openai_required_deployment_keys: { Args: never; Returns: string[] }
      _azure_openai_required_text_model_keys: { Args: never; Returns: string[] }
      _btpm_adoption_template_v1: { Args: never; Returns: Json }
      _clone_anchor_for_phase: { Args: { _phase_id: string }; Returns: string }
      _clone_anchor_for_project: {
        Args: { _project_id: string }
        Returns: string
      }
      _clone_anchor_for_task: { Args: { _task_id: string }; Returns: string }
      _clone_offset_days: {
        Args: { _anchor: string; _target: string }
        Returns: number
      }
      _compute_project_effective_window: {
        Args: { _anchor: string; _bp: Json }
        Returns: Json
      }
      _ensure_membership_layers: {
        Args: {
          _actor: string
          _organization_id: string
          _target_user_id: string
        }
        Returns: undefined
      }
      _gov_advance_next_expected_date: {
        Args: {
          _actual_date_held: string
          _base_date: string
          _frequency_type: string
        }
        Returns: string
      }
      _gov_assert_project_read: {
        Args: { _project_id: string }
        Returns: Record<string, unknown>
      }
      _gov_assert_project_write: {
        Args: { _project_id: string }
        Returns: Record<string, unknown>
      }
      _gov_derive_cadence_status: {
        Args: {
          _archived_at: string
          _due_soon_days?: number
          _frequency_type: string
          _next_expected_date: string
        }
        Returns: string
      }
      _gov_frequency_next_date: {
        Args: { _base_date: string; _frequency_type: string }
        Returns: string
      }
      _gov_report_assert_scope: {
        Args: { _organization_id: string; _workspace_id: string }
        Returns: undefined
      }
      _is_allowed_tenant_integration_secret_name: {
        Args: {
          _integration_kind: Database["public"]["Enums"]["tenant_integration_kind"]
          _secret_name: string
        }
        Returns: boolean
      }
      _kc_ai_meta_decrypt_array: {
        Args: { _cipher: string; _org: string }
        Returns: string[]
      }
      _kc_ai_meta_decrypt_jsonb: {
        Args: { _cipher: string; _org: string }
        Returns: Json
      }
      _kc_ai_meta_encrypt_array: {
        Args: { _arr: string[]; _org: string }
        Returns: string
      }
      _kc_ai_meta_encrypt_jsonb: {
        Args: { _org: string; _value: Json }
        Returns: string
      }
      _lifecycle_bypass_allowed: { Args: never; Returns: boolean }
      _log_admin_authority: {
        Args: {
          _action: string
          _metadata: Json
          _new_role: string
          _new_status: string
          _organization_id: string
          _previous_role: string
          _previous_status: string
          _reason: string
          _target_email: string
          _target_user_id: string
          _tenant_id: string
        }
        Returns: undefined
      }
      _log_entity_material_update: {
        Args: {
          _anchor_id: string
          _anchor_type: string
          _entity_title: string
          _new_object_keys: string[]
          _new_object_labels: Json
          _new_user_ids: string[]
          _new_user_labels: Json
          _old_object_keys: string[]
          _old_object_labels: Json
          _old_user_ids: string[]
          _old_user_labels: Json
          _organization_id: string
          _owner_id: string
          _owner_type: string
          _scalar_diff: Json
          _workspace_id: string
        }
        Returns: undefined
      }
      _normalize_azure_openai_endpoint: {
        Args: { _input: string }
        Returns: string
      }
      _pbi_assert_safe_metadata: { Args: { _meta: Json }; Returns: undefined }
      _planned_extension_allowed: { Args: never; Returns: boolean }
      _ppp_authorize_write: {
        Args: {
          _actor: string
          _preset: Database["public"]["Tables"]["project_people_presets"]["Row"]
          _require_active?: boolean
        }
        Returns: undefined
      }
      _ppp_record_audit: {
        Args: {
          _command: string
          _correlation_id: string
          _idempotency_key: string
          _metadata: Json
          _preset: Database["public"]["Tables"]["project_people_presets"]["Row"]
          _status: Database["public"]["Enums"]["pmg_command_status"]
          _target_id: string
          _target_type: string
        }
        Returns: undefined
      }
      _project_id_from_target: {
        Args: { _target_id: string; _target_type: string }
        Returns: string
      }
      _provision_default_tenant_integrations: {
        Args: { _tenant_id: string }
        Returns: undefined
      }
      _recompute_phase_actuals: {
        Args: { _phase_id: string }
        Returns: undefined
      }
      _recompute_phase_completion: {
        Args: { _phase_id: string }
        Returns: undefined
      }
      _recompute_project_actuals: {
        Args: { _project_id: string }
        Returns: undefined
      }
      _required_tenant_integration_config_names: {
        Args: {
          _integration_kind: Database["public"]["Enums"]["tenant_integration_kind"]
        }
        Returns: string[]
      }
      _required_tenant_integration_secret_names: {
        Args: {
          _integration_kind: Database["public"]["Enums"]["tenant_integration_kind"]
        }
        Returns: string[]
      }
      _safe_integration_config_metadata: {
        Args: { _input: Json }
        Returns: Json
      }
      _sanitize_storage_segment: { Args: { _input: string }; Returns: string }
      _seed_single_org_preference: {
        Args: { _target_user_id: string }
        Returns: undefined
      }
      _snapshot_baseline: { Args: { _project_id: string }; Returns: undefined }
      _template_blueprint_summary: { Args: { _blueprint: Json }; Returns: Json }
      _tenant_ai_provider_readiness: {
        Args: { _provider: string; _tenant_id: string }
        Returns: Json
      }
      _validate_azure_openai_deployments: {
        Args: { _input: Json }
        Returns: Json
      }
      _validate_object_links: {
        Args: { _links: Json; _organization_id: string; _workspace_id: string }
        Returns: undefined
      }
      _validate_user_links:
        | { Args: { _links: Json; _workspace_id: string }; Returns: undefined }
        | {
            Args: { _links: Json; _project_id?: string; _workspace_id: string }
            Returns: undefined
          }
      accept_invitation: { Args: { _token: string }; Returns: string }
      accept_pending_invitation_for_user: {
        Args: { _invitation_id: string; _user_id: string }
        Returns: boolean
      }
      acknowledge_api_d_policy: {
        Args: { _client_key: string; _correlation_id?: string }
        Returns: Json
      }
      activate_ai_instruction_template: {
        Args: { _id: string }
        Returns: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          created_by: string | null
          feature_key: string
          id: string
          instruction_text: string
          notes: string | null
          organization_id: string
          status: string
          title: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ai_instruction_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_adoption_template_tasks_to_existing_plan: {
        Args: {
          _project_id: string
          _selected_task_keys?: string[]
          _template_id?: string
          _template_key?: string
        }
        Returns: Json
      }
      add_project_people_preset_member: {
        Args: {
          _canonical_role_key: string
          _correlation_id?: string
          _expected_preset_updated_at: string
          _external_name: string
          _idempotency_key?: string
          _member_kind: string
          _preset_id: string
          _role_label: string
          _stakeholder_type: string
          _user_id: string
        }
        Returns: Json
      }
      add_project_stakeholder: {
        Args: {
          _external_name: string
          _notes: string
          _project_id: string
          _role_label: string
          _stakeholder_type: string
          _start_date?: string
          _user_id: string
        }
        Returns: string
      }
      add_roadmap_story_pack_external_file: {
        Args: {
          _display_name?: string
          _drive_id: string
          _include_in_story?: boolean
          _item_id: string
          _mime_type?: string
          _provider?: string
          _size_bytes?: number
          _story_pack_id: string
          _user_note?: string
          _web_url?: string
        }
        Returns: string
      }
      add_roadmap_story_pack_note: {
        Args: {
          _body: string
          _include_in_story?: boolean
          _label?: string
          _sort_order?: number
          _story_pack_id: string
        }
        Returns: string
      }
      adjust_governance_cadence_next_expected_date: {
        Args: { _cadence_id: string; _next_expected_date: string }
        Returns: undefined
      }
      admin_add_portfolio_team_member: {
        Args: { _portfolio_item_id: string; _role: string; _user_id: string }
        Returns: string
      }
      admin_add_workspace_access: {
        Args: {
          _organization_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _target_user_id: string
          _workspace_id: string
        }
        Returns: undefined
      }
      admin_archive_portfolio_item: {
        Args: { _is_archived?: boolean; _portfolio_item_id: string }
        Returns: undefined
      }
      admin_assign_projects_to_portfolio: {
        Args: { _portfolio_item_id: string; _project_ids: string[] }
        Returns: Json
      }
      admin_change_workspace_role: {
        Args: {
          _new_role: Database["public"]["Enums"]["app_role"]
          _organization_id: string
          _target_user_id: string
          _workspace_id: string
        }
        Returns: undefined
      }
      admin_create_invitation: {
        Args: {
          _email: string
          _organization_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _workspace_id: string
        }
        Returns: string
      }
      admin_create_portfolio_item: {
        Args: {
          _code?: string
          _description?: string
          _lifecycle_state?: string
          _name: string
          _organization_id: string
          _owner_id?: string
          _strategic_priority?: string
        }
        Returns: string
      }
      admin_deactivate_user: {
        Args: { _organization_id: string; _target_user_id: string }
        Returns: undefined
      }
      admin_delete_invitation: {
        Args: { _invitation_id: string; _organization_id: string }
        Returns: undefined
      }
      admin_delete_knowledge_article_ai_metadata: {
        Args: { _article_id: string }
        Returns: undefined
      }
      admin_delete_user: {
        Args: { _organization_id: string; _target_user_id: string }
        Returns: undefined
      }
      admin_disable_tenant_secret: {
        Args: { _reason?: string; _revoke?: boolean; _secret_ref_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          disabled_at: string | null
          id: string
          integration_id: string
          organization_id: string | null
          revoked_at: string | null
          rotated_at: string | null
          secret_fingerprint: string | null
          secret_kind: string
          secret_name: string
          secret_scope: Database["public"]["Enums"]["tenant_secret_scope"]
          status: Database["public"]["Enums"]["tenant_secret_status"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vault_secret_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenant_secret_refs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_get_knowledge_article_ai_metadata: {
        Args: { _article_id: string }
        Returns: {
          ai_flow: string
          answer_rules: string[]
          article_id: string
          audience: string[]
          created_at: string
          created_by: string
          feature_area: string[]
          forbidden_claims: string[]
          freshness_label: string
          question_examples: string[]
          related_feature_flags: string[]
          route_patterns: string[]
          synonyms: string[]
          updated_at: string
          updated_by: string
          user_intents: string[]
        }[]
      }
      admin_list_btpm_import_batches: {
        Args: { _organization_id: string }
        Returns: {
          committed_at: string
          counts_json: Json
          created_at: string
          dry_run_at: string
          id: string
          import_type: string
          organization_id: string
          payload_hash: string
          requested_by: string
          requested_by_display_name: string
          requested_by_email: string
          safe_issue_summary_json: Json
          safe_summary_json: Json
          schema_version: string
          source_file_name: string
          source_name: string
          status: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      admin_list_invitations: {
        Args: { _organization_id: string }
        Returns: {
          email: string
          expires_at: string
          id: string
          invited_at: string
          is_expired: boolean
          role: string
          status: string
          workspace_name: string
        }[]
      }
      admin_list_org_workspaces: {
        Args: { _organization_id: string }
        Returns: Json
      }
      admin_list_portfolio_items: {
        Args: { _include_archived?: boolean; _organization_id: string }
        Returns: Json
      }
      admin_list_portfolio_project_assignment_candidates: {
        Args: {
          _include_archived?: boolean
          _portfolio_item_id: string
          _search?: string
          _workspace_ids?: string[]
        }
        Returns: Json
      }
      admin_list_portfolio_team_members: {
        Args: { _portfolio_item_id: string }
        Returns: Json
      }
      admin_list_project_move_candidates: {
        Args: { _organization_id: string }
        Returns: Json
      }
      admin_list_tenant_integration_secret_metadata: {
        Args: { _integration_id: string; _reason?: string }
        Returns: {
          disabled_at: string
          fingerprint: string
          integration_id: string
          organization_id: string
          organization_name: string
          revoked_at: string
          rotated_at: string
          secret_kind: string
          secret_name: string
          secret_ref_id: string
          secret_scope: Database["public"]["Enums"]["tenant_secret_scope"]
          status: Database["public"]["Enums"]["tenant_secret_status"]
          updated_at: string
        }[]
      }
      admin_list_tenant_integrations: {
        Args: { _tenant_id: string }
        Returns: {
          active_secret_count: number
          config_metadata: Json
          config_metadata_key_count: number
          configuration_issue_code: string
          configuration_ready: boolean
          configured_required_secret_count: number
          has_config_metadata: boolean
          integration_id: string
          is_enabled: boolean
          kind: Database["public"]["Enums"]["tenant_integration_kind"]
          last_error_at: string
          last_error_message: string
          last_success_at: string
          last_tested_at: string
          missing_required_secret_count: number
          name: string
          organization_override_count: number
          required_secret_count: number
          status: Database["public"]["Enums"]["tenant_integration_status"]
          tenant_secret_count: number
        }[]
      }
      admin_move_project_workspace: {
        Args: {
          _confirm_program_clear?: boolean
          _organization_id: string
          _project_id: string
          _target_program_id?: string
          _target_workspace_id: string
        }
        Returns: Json
      }
      admin_preview_project_workspace_move: {
        Args: {
          _organization_id: string
          _project_id: string
          _target_program_id?: string
          _target_workspace_id: string
        }
        Returns: Json
      }
      admin_reactivate_user: {
        Args: { _organization_id: string; _target_user_id: string }
        Returns: undefined
      }
      admin_remove_portfolio_team_member: {
        Args: { _team_member_id: string }
        Returns: undefined
      }
      admin_remove_projects_from_portfolio: {
        Args: { _portfolio_item_id: string; _project_ids: string[] }
        Returns: Json
      }
      admin_remove_workspace_access: {
        Args: {
          _organization_id: string
          _target_user_id: string
          _workspace_id: string
        }
        Returns: undefined
      }
      admin_resend_invitation: {
        Args: { _invitation_id: string; _organization_id: string }
        Returns: undefined
      }
      admin_revoke_invitation: {
        Args: { _invitation_id: string; _organization_id: string }
        Returns: undefined
      }
      admin_set_org_admin: {
        Args: {
          _is_admin: boolean
          _organization_id: string
          _target_user_id: string
        }
        Returns: undefined
      }
      admin_store_tenant_secret: {
        Args: {
          _fingerprint?: string
          _integration_id: string
          _organization_id?: string
          _reason?: string
          _scope?: Database["public"]["Enums"]["tenant_secret_scope"]
          _secret_kind: string
          _secret_name: string
          _secret_value: string
          _tenant_id: string
        }
        Returns: Json
      }
      admin_test_tenant_integration_metadata: {
        Args: { _integration_id: string; _reason?: string }
        Returns: Json
      }
      admin_update_portfolio_item: {
        Args: {
          _code?: string
          _description?: string
          _lifecycle_state?: string
          _name: string
          _owner_id?: string
          _portfolio_item_id: string
          _strategic_priority?: string
        }
        Returns: undefined
      }
      admin_update_portfolio_team_member_role: {
        Args: { _role: string; _team_member_id: string }
        Returns: undefined
      }
      admin_upsert_knowledge_article_ai_metadata:
        | {
            Args: {
              _ai_flow?: string
              _answer_rules?: string[]
              _article_id: string
              _audience?: string[]
              _feature_area?: string[]
              _forbidden_claims?: string[]
              _freshness_label?: string
              _question_examples?: string[]
              _related_feature_flags?: string[]
              _route_patterns?: string[]
              _synonyms?: string[]
              _user_intents?: string[]
            }
            Returns: string
          }
        | {
            Args: {
              _ai_flow?: string
              _answer_rules?: string[]
              _article_id: string
              _audience?: string[]
              _feature_area?: string[]
              _forbidden_claims?: string[]
              _freshness_label?: string
              _question_examples?: string[]
              _related_feature_flags?: string[]
              _route_patterns?: string[]
              _synonyms?: string[]
              _user_intents?: string[]
              _workflow_metadata?: Json
            }
            Returns: string
          }
      admin_upsert_tenant_integration: {
        Args: {
          _config?: Json
          _is_enabled?: boolean
          _kind: Database["public"]["Enums"]["tenant_integration_kind"]
          _name?: string
          _reason?: string
          _status?: Database["public"]["Enums"]["tenant_integration_status"]
          _tenant_id: string
        }
        Returns: {
          config_metadata: Json
          created_at: string
          created_by: string | null
          id: string
          is_enabled: boolean
          kind: Database["public"]["Enums"]["tenant_integration_kind"]
          last_error_at: string | null
          last_error_message: string | null
          last_success_at: string | null
          last_tested_at: string | null
          name: string
          status: Database["public"]["Enums"]["tenant_integration_status"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenant_integrations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      adoption_resolve_object_project: {
        Args: { _object_id: string; _object_type: string }
        Returns: string
      }
      ai_guide_v2_admin_get_chunk_summary: {
        Args: { p_organization_id: string }
        Returns: {
          source_status: string
          source_type: string
          total_count: number
          vector_ready_count: number
        }[]
      }
      ai_guide_v2_admin_reindex_knowledge: {
        Args: { p_article_id?: string; p_force?: boolean; p_scope: string }
        Returns: {
          job_id: string
          status: string
        }[]
      }
      ai_guide_v2_list_index_status: {
        Args: { p_organization_id: string }
        Returns: {
          embedding_dimensions: number
          embedding_model: string
          failed_jobs_24h: number
          last_indexed_at: string
          stale_count: number
          total_chunks: number
          vector_ready_count: number
        }[]
      }
      ai_guide_v2_match_knowledge_chunks: {
        Args: {
          p_feature_area?: string[]
          p_intent_type?: string
          p_match_count?: number
          p_min_similarity?: number
          p_organization_id: string
          p_route?: string
          p_user_id: string
          p_workflow_id?: string
          query_embedding: string
        }
        Returns: {
          article_id: string
          article_slug: string
          article_title: string
          chunk_id: string
          feature_match: boolean
          hybrid_score: number
          metadata: Json
          route_match: boolean
          similarity: number
          source_confidence: string
          source_id: string
          source_type: string
          workflow_match: boolean
        }[]
      }
      ai_help_admin_list_history_feedback: {
        Args: {
          _context_route?: string
          _date_from?: string
          _date_to?: string
          _limit?: number
          _rating?: string
          _reason_code?: string
          _search?: string
          _user_id?: string
        }
        Returns: {
          assistant_answer: string
          assistant_created_at: string
          assistant_message_id: string
          context_label: string
          context_route: string
          conversation_created_at: string
          conversation_id: string
          conversation_title: string
          conversation_updated_at: string
          feedback_comment: string
          feedback_created_at: string
          feedback_id: string
          feedback_rating: string
          feedback_reason_code: string
          feedback_updated_at: string
          source_article_ids: string[]
          user_email: string
          user_id: string
          user_message_id: string
          user_question: string
        }[]
      }
      ai_help_append_message: {
        Args: {
          _content: string
          _context_label?: string
          _context_route?: string
          _conversation_id: string
          _role: string
          _source_article_ids?: string[]
        }
        Returns: string
      }
      ai_help_archive_conversation: {
        Args: { _conversation_id: string }
        Returns: undefined
      }
      ai_help_create_conversation: {
        Args: {
          _context_label?: string
          _context_route?: string
          _title?: string
        }
        Returns: string
      }
      ai_help_list_conversations: {
        Args: { _include_archived?: boolean }
        Returns: {
          archived_at: string
          context_label: string
          context_route: string
          created_at: string
          id: string
          title: string
          updated_at: string
        }[]
      }
      ai_help_list_messages: {
        Args: { _conversation_id: string }
        Returns: {
          content: string
          context_label: string
          context_route: string
          created_at: string
          id: string
          role: string
          source_article_ids: string[]
        }[]
      }
      ai_help_list_my_feedback_for_conversation: {
        Args: { _conversation_id: string }
        Returns: {
          assistant_message_id: string
          comment: string
          created_at: string
          id: string
          rating: string
          reason_code: string
          updated_at: string
        }[]
      }
      ai_help_update_conversation_title: {
        Args: { _conversation_id: string; _title: string }
        Returns: undefined
      }
      ai_help_upsert_message_feedback: {
        Args: {
          _assistant_message_id: string
          _comment?: string
          _rating: string
          _reason_code?: string
        }
        Returns: {
          assistant_message_id: string
          comment: string
          conversation_id: string
          created_at: string
          id: string
          rating: string
          reason_code: string
          updated_at: string
        }[]
      }
      api_g_5_10_get_mcp_connection_verification: {
        Args: { _api_client_id: string }
        Returns: {
          last_successful_authentication_at: string
          verified: boolean
        }[]
      }
      api_g_5_10_get_organization_client_rate_profile: {
        Args: { _api_client_id: string; _organization_id: string }
        Returns: {
          assigned_at: string
          description: string
          display_name: string
          is_default: boolean
          is_explicit: boolean
          profile_key: string
          request_limit: number
          window_seconds: number
        }[]
      }
      api_g_5_10_list_client_activity: {
        Args: {
          _api_client_id: string
          _before_event_at?: string
          _before_event_id?: string
          _limit?: number
          _organization_id?: string
        }
        Returns: {
          actor_user_id: string
          api_client_id: string
          api_version: string
          correlation_id: string
          duration_ms: number
          event_at: string
          event_id: string
          http_method: string
          http_status: number
          organization_id: string
          project_id: string
          route_id: string
          scope_level: string
          source_channel: string
          status_class: string
          tenant_id: string
          workspace_id: string
        }[]
      }
      api_g_5_10_list_rate_profile_catalogue: {
        Args: never
        Returns: {
          description: string
          display_name: string
          is_default: boolean
          profile_key: string
          request_limit: number
          window_seconds: number
        }[]
      }
      api_g_5_10_record_api_activity: {
        Args: {
          _actor_user_id?: string
          _api_client_id: string
          _api_version: string
          _correlation_id?: string
          _duration_ms: number
          _http_method: string
          _http_status: number
          _organization_id?: string
          _project_id?: string
          _route_id: string
          _tenant_id?: string
          _workspace_id?: string
        }
        Returns: string
      }
      api_g_5_10_record_mcp_connection_verification: {
        Args: {
          _actor_user_id: string
          _api_client_id: string
          _request_id: string
        }
        Returns: string
      }
      api_g_5_10_resolve_target_activity_scope: {
        Args: { _target_id: string; _target_type: string }
        Returns: {
          organization_id: string
          project_id: string
          tenant_id: string
          workspace_id: string
        }[]
      }
      api_g_5_10_set_organization_client_rate_profile: {
        Args: {
          _api_client_id: string
          _organization_id: string
          _profile_key: string
        }
        Returns: {
          assigned_at: string
          description: string
          display_name: string
          is_default: boolean
          is_explicit: boolean
          profile_key: string
          request_limit: number
          window_seconds: number
        }[]
      }
      api_g_5_5_platform_create_client: {
        Args: {
          _client_key: string
          _description?: string
          _display_name: string
          _oauth_client_id?: string
        }
        Returns: string
      }
      api_g_5_5_platform_create_oauth_redirect: {
        Args: { _api_client_id: string; _redirect_uri: string }
        Returns: string
      }
      api_g_5_5_platform_create_policy_version: {
        Args: {
          _api_client_id: string
          _policy_document: string
          _policy_uri: string
          _version: string
        }
        Returns: string
      }
      api_g_5_5_platform_transition_client: {
        Args: { _api_client_id: string; _target_lifecycle_status: string }
        Returns: string
      }
      api_g_5_5_platform_transition_oauth_redirect: {
        Args: { _redirect_id: string; _target_lifecycle_status: string }
        Returns: string
      }
      api_g_5_5_platform_transition_policy_version: {
        Args: { _policy_version_id: string; _target_lifecycle_status: string }
        Returns: string
      }
      api_g_5_5_platform_update_draft_client: {
        Args: {
          _api_client_id: string
          _description?: string
          _display_name: string
          _oauth_client_id?: string
        }
        Returns: string
      }
      api_g_5_5_platform_update_draft_oauth_redirect: {
        Args: { _redirect_id: string; _redirect_uri: string }
        Returns: string
      }
      api_g_5_5_platform_update_draft_policy_version: {
        Args: {
          _policy_document: string
          _policy_uri: string
          _policy_version_id: string
          _version: string
        }
        Returns: string
      }
      api_g_5_6_platform_get_client: {
        Args: { _api_client_id: string }
        Returns: Json
      }
      api_g_5_6_platform_list_assignable_capabilities: {
        Args: never
        Returns: {
          api_version: string
          capability_key: string
          capability_kind: string
          description: string
          display_name: string
          http_method: string
          route_id: string
          route_path: string
          scope_level: string
        }[]
      }
      api_g_5_6_platform_list_clients: {
        Args: { _include_retired?: boolean; _limit?: number; _offset?: number }
        Returns: {
          active_policy_version: string
          active_redirect_count: number
          client_key: string
          created_at: string
          description: string
          display_name: string
          enabled_supported_capability_count: number
          id: string
          lifecycle_status: string
          oauth_client_id: string
          policy_version_count: number
          redirect_count: number
          total_count: number
          updated_at: string
        }[]
      }
      api_g_5_6_platform_transition_supported_capability: {
        Args: {
          _api_client_id: string
          _api_version: string
          _capability_key: string
          _capability_kind: string
          _target_lifecycle_status: string
        }
        Returns: string
      }
      api_g_5_7_admin_list_organization_client_capabilities: {
        Args: {
          _api_client_id: string
          _limit: number
          _offset: number
          _organization_id: string
        }
        Returns: {
          administrator_assignable: boolean
          api_version: string
          capability_key: string
          capability_kind: string
          catalogue_lifecycle_status: string
          description: string
          display_name: string
          grant_disabled_at: string
          grant_enabled_at: string
          grant_id: string
          grant_status: string
          scope_level: string
          supported_capability_id: string
          supported_capability_status: string
          total_count: number
        }[]
      }
      api_g_5_7_admin_list_organization_client_workspaces: {
        Args: {
          _api_client_id: string
          _include_archived: boolean
          _limit: number
          _offset: number
          _organization_id: string
        }
        Returns: {
          enabled_capability_grant_count: number
          enabled_project_count: number
          total_count: number
          workspace_disabled_at: string
          workspace_enabled_at: string
          workspace_enablement_id: string
          workspace_enablement_status: string
          workspace_id: string
          workspace_is_archived: boolean
          workspace_name: string
        }[]
      }
      api_g_5_7_admin_list_organization_clients: {
        Args: {
          _include_retired: boolean
          _limit: number
          _offset: number
          _organization_id: string
        }
        Returns: {
          active_policy_version: string
          api_client_id: string
          client_key: string
          client_lifecycle_status: string
          description: string
          display_name: string
          enabled_capability_grant_count: number
          enabled_project_count: number
          enabled_workspace_count: number
          organization_disabled_at: string
          organization_enabled_at: string
          organization_enablement_id: string
          organization_enablement_status: string
          total_count: number
        }[]
      }
      api_g_5_7_admin_list_workspace_client_capabilities: {
        Args: {
          _api_client_id: string
          _limit: number
          _offset: number
          _organization_id: string
          _workspace_id: string
        }
        Returns: {
          administrator_assignable: boolean
          api_version: string
          capability_key: string
          capability_kind: string
          catalogue_lifecycle_status: string
          description: string
          display_name: string
          effective_grant_source: string
          effective_grant_status: string
          organization_grant_disabled_at: string
          organization_grant_enabled_at: string
          organization_grant_id: string
          organization_grant_status: string
          scope_level: string
          supported_capability_id: string
          supported_capability_status: string
          total_count: number
          workspace_grant_disabled_at: string
          workspace_grant_enabled_at: string
          workspace_grant_id: string
          workspace_grant_status: string
        }[]
      }
      api_g_5_7_admin_list_workspace_client_projects: {
        Args: {
          _api_client_id: string
          _include_archived: boolean
          _limit: number
          _offset: number
          _organization_id: string
          _workspace_id: string
        }
        Returns: {
          project_disabled_at: string
          project_enabled_at: string
          project_enablement_id: string
          project_enablement_status: string
          project_id: string
          project_is_archived: boolean
          project_name: string
          total_count: number
        }[]
      }
      api_g_5_7_admin_transition_organization_client: {
        Args: {
          _api_client_id: string
          _organization_id: string
          _target_lifecycle_status: string
        }
        Returns: string
      }
      api_g_5_7_admin_transition_organization_client_capability: {
        Args: {
          _api_client_id: string
          _api_version: string
          _capability_key: string
          _organization_id: string
          _target_lifecycle_status: string
        }
        Returns: string
      }
      api_g_5_7_admin_transition_project_client: {
        Args: {
          _api_client_id: string
          _organization_id: string
          _project_id: string
          _target_lifecycle_status: string
          _workspace_id: string
        }
        Returns: string
      }
      api_g_5_7_admin_transition_workspace_client: {
        Args: {
          _api_client_id: string
          _organization_id: string
          _target_lifecycle_status: string
          _workspace_id: string
        }
        Returns: string
      }
      api_g_5_7_admin_transition_workspace_client_capability: {
        Args: {
          _api_client_id: string
          _api_version: string
          _capability_key: string
          _organization_id: string
          _target_lifecycle_status: string
          _workspace_id: string
        }
        Returns: string
      }
      api_g_5_9_disconnect_my_connected_app: {
        Args: { _client_key: string; _correlation_id?: string }
        Returns: Json
      }
      api_g_5_9_list_my_connected_apps: {
        Args: { _limit: number; _offset: number }
        Returns: {
          capabilities: Json
          client_key: string
          connection_status: string
          description: string
          display_name: string
          latest_acknowledged_at: string
          organizations: Json
          policy: Json
          total_count: number
          workspaces: Json
        }[]
      }
      api_ux_mcp_admin_1_platform_set_client_protected_resource: {
        Args: {
          _actor_user_id: string
          _api_client_id: string
          _resolved_resource_audience?: string
          _resource_type: string
        }
        Returns: Json
      }
      api_v1_append_execution_update: {
        Args: {
          _correlation_id: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _payload_hash: string
          _request_id: string
          _status_label: string
          _summary: string
          _target_id: string
          _target_type: string
          _update_date: string
        }
        Returns: Json
      }
      api_v1_append_kpi_update: {
        Args: {
          _correlation_id: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _kpi_definition_id: string
          _note: string
          _payload_hash: string
          _request_id: string
          _update_date: string
          _value: number
        }
        Returns: Json
      }
      api_v1_assign_project_portfolio: {
        Args: {
          _correlation_id: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _payload_hash: string
          _portfolio_item_id: string
          _project_id: string
          _request_id: string
        }
        Returns: Json
      }
      api_v1_assign_task: {
        Args: {
          _assignee_id: string
          _correlation_id: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _payload_hash: string
          _request_id: string
          _task_id: string
        }
        Returns: Json
      }
      api_v1_create_blocker: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _payload_hash: string
          _request_id: string
          _severity: string
          _status: string
          _target_id: string
          _target_type: string
          _title: string
        }
        Returns: Json
      }
      api_v1_create_kpi: {
        Args: {
          _action_plan_required: boolean
          _auto_snapshot_enabled: boolean
          _cadence: string
          _calculation_key: string
          _comment_required: boolean
          _completion_method: string
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _formula_version: number
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _project_id: string
          _request_id: string
          _source_mode: string
          _target_direction: string
          _target_value: number
          _unit: string
          _value_type: string
        }
        Returns: Json
      }
      api_v1_create_phase: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _phase_type: string
          _project_id: string
          _request_id: string
          _sort_order: number
          _start_date: string
          _status: string
          _target_end_date: string
        }
        Returns: Json
      }
      api_v1_create_portfolio: {
        Args: {
          _code: string
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _lifecycle_state: string
          _name: string
          _organization_id: string
          _owner_id: string
          _payload_hash: string
          _request_id: string
          _strategic_priority: string
        }
        Returns: Json
      }
      api_v1_create_program: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _request_id: string
          _workspace_id: string
        }
        Returns: Json
      }
      api_v1_create_project: {
        Args: {
          _correlation_id: string
          _delivery_model: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _program_id: string
          _request_id: string
          _workspace_id: string
        }
        Returns: Json
      }
      api_v1_create_risk: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _impact: string
          _likelihood: string
          _mitigation_plan: string
          _payload_hash: string
          _request_id: string
          _status: string
          _target_id: string
          _target_type: string
          _title: string
        }
        Returns: Json
      }
      api_v1_create_task: {
        Args: {
          _correlation_id: string
          _description: string
          _due_date: string
          _estimated_hours: number
          _expected_oauth_client_id: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _phase_id: string
          _priority: string
          _request_id: string
          _sort_order: number
          _start_date: string
          _status: string
          _task_type: string
        }
        Returns: Json
      }
      api_v1_get_blocker: {
        Args: { _blocker_id: string; _expected_oauth_client_id: string }
        Returns: Json
      }
      api_v1_get_kpi: {
        Args: { _expected_oauth_client_id: string; _kpi_id: string }
        Returns: Json
      }
      api_v1_get_me: {
        Args: { _expected_oauth_client_id: string }
        Returns: Json
      }
      api_v1_get_me_context: {
        Args: {
          _context_id?: string
          _context_type?: string
          _expected_oauth_client_id: string
        }
        Returns: Json
      }
      api_v1_get_phase: {
        Args: { _expected_oauth_client_id: string; _phase_id: string }
        Returns: Json
      }
      api_v1_get_portfolio: {
        Args: { _expected_oauth_client_id: string; _portfolio_item_id: string }
        Returns: Json
      }
      api_v1_get_program: {
        Args: { _expected_oauth_client_id: string; _program_id: string }
        Returns: Json
      }
      api_v1_get_project: {
        Args: { _expected_oauth_client_id: string; _project_id: string }
        Returns: Json
      }
      api_v1_get_project_planning: {
        Args: { _expected_oauth_client_id: string; _project_id: string }
        Returns: Json
      }
      api_v1_get_risk: {
        Args: { _expected_oauth_client_id: string; _risk_id: string }
        Returns: Json
      }
      api_v1_get_task: {
        Args: { _expected_oauth_client_id: string; _task_id: string }
        Returns: Json
      }
      api_v1_list_execution_updates: {
        Args: {
          _after_created_at: string
          _after_id: string
          _expected_oauth_client_id: string
          _limit: number
          _target_id: string
          _target_type: string
        }
        Returns: Json
      }
      api_v1_list_kpi_updates: {
        Args: {
          _after_created_at: string
          _after_id: string
          _after_update_date: string
          _expected_oauth_client_id: string
          _kpi_id: string
          _limit: number
        }
        Returns: Json
      }
      api_v1_list_organizations: {
        Args: {
          _expected_oauth_client_id: string
          _limit?: number
          _offset?: number
          _search?: string
        }
        Returns: Json
      }
      api_v1_list_portfolio_projects: {
        Args: {
          _expected_oauth_client_id: string
          _limit?: number
          _offset?: number
          _portfolio_item_id: string
          _search?: string
        }
        Returns: Json
      }
      api_v1_list_portfolios: {
        Args: {
          _expected_oauth_client_id: string
          _include_archived?: boolean
          _limit?: number
          _offset?: number
          _organization_id: string
          _search?: string
        }
        Returns: Json
      }
      api_v1_list_programs: {
        Args: {
          _expected_oauth_client_id: string
          _limit?: number
          _offset?: number
          _search?: string
          _workspace_id: string
        }
        Returns: Json
      }
      api_v1_list_project_blockers: {
        Args: {
          _after_created_at: string
          _after_id: string
          _expected_oauth_client_id: string
          _limit: number
          _project_id: string
        }
        Returns: Json
      }
      api_v1_list_project_kpis: {
        Args: {
          _expected_oauth_client_id: string
          _include_archived: boolean
          _limit: number
          _offset: number
          _project_id: string
        }
        Returns: Json
      }
      api_v1_list_project_risks: {
        Args: {
          _after_created_at: string
          _after_id: string
          _expected_oauth_client_id: string
          _limit: number
          _project_id: string
        }
        Returns: Json
      }
      api_v1_list_projects: {
        Args: {
          _expected_oauth_client_id: string
          _limit?: number
          _offset?: number
          _search?: string
          _workspace_id: string
        }
        Returns: Json
      }
      api_v1_list_workspace_members: {
        Args: {
          _expected_oauth_client_id: string
          _limit?: number
          _offset?: number
          _search?: string
          _workspace_id: string
        }
        Returns: Json
      }
      api_v1_list_workspaces: {
        Args: {
          _expected_oauth_client_id: string
          _limit?: number
          _offset?: number
          _organization_id: string
          _search?: string
        }
        Returns: Json
      }
      api_v1_plan_phase: {
        Args: {
          _confirm_parent_extension: boolean
          _correlation_id: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _new_end: string
          _new_start: string
          _payload_hash: string
          _phase_id: string
          _request_id: string
        }
        Returns: Json
      }
      api_v1_plan_task: {
        Args: {
          _confirm_parent_extension: boolean
          _correlation_id: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _new_due: string
          _new_start: string
          _payload_hash: string
          _request_id: string
          _task_id: string
        }
        Returns: Json
      }
      api_v1_reorder_phases: {
        Args: {
          _correlation_id: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _payload_hash: string
          _project_id: string
          _request_id: string
          _rows: Json
        }
        Returns: Json
      }
      api_v1_reorder_tasks: {
        Args: {
          _correlation_id: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _payload_hash: string
          _phase_id: string
          _request_id: string
          _rows: Json
        }
        Returns: Json
      }
      api_v1_transition_project: {
        Args: {
          _confirm_warnings: boolean
          _correlation_id: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _payload_hash: string
          _project_id: string
          _request_id: string
          _target_status: string
        }
        Returns: Json
      }
      api_v1_transition_task: {
        Args: {
          _actual_end_date: string
          _actual_start_date: string
          _correlation_id: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _payload_hash: string
          _request_id: string
          _set_actual_end: boolean
          _set_actual_start: boolean
          _status: string
          _task_id: string
        }
        Returns: Json
      }
      api_v1_update_blocker: {
        Args: {
          _blocker_id: string
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _payload_hash: string
          _request_id: string
          _severity: string
          _status: string
          _title: string
        }
        Returns: Json
      }
      api_v1_update_kpi: {
        Args: {
          _action_plan_required: boolean
          _auto_snapshot_enabled: boolean
          _cadence: string
          _calculation_key: string
          _comment_required: boolean
          _completion_method: string
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _formula_version: number
          _idempotency_key: string
          _kpi_definition_id: string
          _name: string
          _payload_hash: string
          _request_id: string
          _set_action_plan_required: boolean
          _set_auto_snapshot_enabled: boolean
          _set_cadence: boolean
          _set_calculation_key: boolean
          _set_comment_required: boolean
          _set_completion_method: boolean
          _set_description: boolean
          _set_formula_version: boolean
          _set_name: boolean
          _set_source_mode: boolean
          _set_target_direction: boolean
          _set_target_value: boolean
          _set_unit: boolean
          _set_value_type: boolean
          _source_mode: string
          _target_direction: string
          _target_value: number
          _unit: string
          _value_type: string
        }
        Returns: Json
      }
      api_v1_update_phase: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _phase_id: string
          _phase_type: string
          _request_id: string
          _status: string
        }
        Returns: Json
      }
      api_v1_update_portfolio: {
        Args: {
          _code: string
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _lifecycle_state: string
          _name: string
          _owner_id: string
          _payload_hash: string
          _portfolio_item_id: string
          _request_id: string
          _set_code: boolean
          _set_description: boolean
          _set_lifecycle_state: boolean
          _set_name: boolean
          _set_owner_id: boolean
          _set_strategic_priority: boolean
          _strategic_priority: string
        }
        Returns: Json
      }
      api_v1_update_program: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _program_id: string
          _request_id: string
          _set_description: boolean
          _status: string
        }
        Returns: Json
      }
      api_v1_update_project: {
        Args: {
          _assumptions: string
          _budget_narrative: string
          _business_case: string
          _charter: string
          _completion_criteria: string
          _constraints: string
          _correlation_id: string
          _delivery_model: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _goals: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _priority: string
          _program_id: string
          _project_id: string
          _request_id: string
          _scope_in: string
          _scope_out: string
          _set_assumptions: boolean
          _set_budget_narrative: boolean
          _set_business_case: boolean
          _set_charter: boolean
          _set_completion_criteria: boolean
          _set_constraints: boolean
          _set_delivery_model: boolean
          _set_description: boolean
          _set_goals: boolean
          _set_name: boolean
          _set_priority: boolean
          _set_program_id: boolean
          _set_scope_in: boolean
          _set_scope_out: boolean
          _set_success_criteria: boolean
          _success_criteria: string
        }
        Returns: Json
      }
      api_v1_update_risk: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _impact: string
          _likelihood: string
          _mitigation_plan: string
          _payload_hash: string
          _request_id: string
          _risk_id: string
          _status: string
          _title: string
        }
        Returns: Json
      }
      api_v1_update_task: {
        Args: {
          _correlation_id: string
          _description: string
          _estimated_hours: number
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _priority: string
          _request_id: string
          _status: string
          _task_id: string
          _task_type: string
        }
        Returns: Json
      }
      append_execution_update: {
        Args: {
          _correlation_id?: string
          _idempotency_key?: string
          _status_label?: string
          _summary: string
          _target_id: string
          _target_type: string
          _update_date: string
        }
        Returns: Json
      }
      append_kpi_update: {
        Args: {
          _correlation_id?: string
          _idempotency_key?: string
          _kpi_definition_id: string
          _note?: string
          _update_date: string
          _value: number
        }
        Returns: Json
      }
      apply_backlog_item_create: {
        Args: {
          _correlation_id?: string
          _description?: string
          _idempotency_key?: string
          _phase_id?: string
          _priority?: string
          _project_id: string
          _sprint_id?: string
          _title: string
          _workflow_state_id?: string
        }
        Returns: Json
      }
      apply_backlog_item_update: {
        Args: {
          _backlog_item_id: string
          _correlation_id?: string
          _description?: string
          _expected_updated_at: string
          _idempotency_key?: string
          _phase_id?: string
          _priority?: string
          _set_description?: boolean
          _set_phase_id?: boolean
          _set_priority?: boolean
          _set_sprint_id?: boolean
          _set_title?: boolean
          _set_workflow_state_id?: boolean
          _sprint_id?: string
          _title?: string
          _workflow_state_id?: string
        }
        Returns: Json
      }
      apply_blocker_create: {
        Args: {
          _correlation_id?: string
          _description?: string
          _idempotency_key?: string
          _object_links?: Json
          _severity?: string
          _status?: string
          _target_id: string
          _target_type: string
          _title: string
          _user_links?: Json
        }
        Returns: Json
      }
      apply_blocker_update: {
        Args: {
          _blocker_id: string
          _correlation_id?: string
          _description?: string
          _expected_updated_at: string
          _idempotency_key?: string
          _object_links?: Json
          _severity?: string
          _status?: string
          _title: string
          _user_links?: Json
        }
        Returns: Json
      }
      apply_governance_record_create: {
        Args: {
          _actual_date_held: string
          _cadence_id?: string
          _correlation_id?: string
          _decision_owner_stakeholder_id?: string
          _decision_question?: string
          _decision_stage?: string
          _decisions?: Json
          _decisions_summary?: string
          _event_name?: string
          _event_type: string
          _expected_date_snapshot?: string
          _external_reference_url?: string
          _idempotency_key?: string
          _links?: Json
          _project_id: string
          _record_kind?: string
          _sharepoint_evidence_reference?: string
          _summary?: string
          _target_decision_date?: string
        }
        Returns: Json
      }
      apply_governance_record_update: {
        Args: {
          _actual_date_held?: string
          _cadence_id?: string
          _clear_cadence?: boolean
          _clear_decision_owner_stakeholder_id?: boolean
          _clear_decision_question?: boolean
          _clear_decisions_summary?: boolean
          _clear_event_name?: boolean
          _clear_expected_date_snapshot?: boolean
          _clear_external_reference_url?: boolean
          _clear_sharepoint_evidence_reference?: boolean
          _clear_summary?: boolean
          _clear_target_decision_date?: boolean
          _correlation_id?: string
          _decision_owner_stakeholder_id?: string
          _decision_question?: string
          _decision_stage?: string
          _decisions?: Json
          _decisions_summary?: string
          _event_name?: string
          _event_type?: string
          _expected_date_snapshot?: string
          _expected_updated_at: string
          _external_reference_url?: string
          _idempotency_key?: string
          _links?: Json
          _record_id: string
          _sharepoint_evidence_reference?: string
          _summary?: string
          _target_decision_date?: string
        }
        Returns: Json
      }
      apply_kpi_definition_create: {
        Args: {
          _action_plan_required?: boolean
          _auto_snapshot_enabled?: boolean
          _cadence?: string
          _calculation_key?: string
          _comment_required?: boolean
          _completion_method?: string
          _correlation_id?: string
          _description?: string
          _formula_version?: number
          _idempotency_key?: string
          _name: string
          _project_id: string
          _source_mode?: string
          _target_direction?: Database["public"]["Enums"]["kpi_target_direction"]
          _target_value?: number
          _unit?: string
          _value_type?: string
        }
        Returns: Json
      }
      apply_kpi_definition_update: {
        Args: {
          _action_plan_required?: boolean
          _auto_snapshot_enabled?: boolean
          _cadence?: string
          _calculation_key?: string
          _comment_required?: boolean
          _completion_method?: string
          _correlation_id?: string
          _description?: string
          _expected_updated_at: string
          _formula_version?: number
          _idempotency_key?: string
          _kpi_definition_id: string
          _name?: string
          _set_action_plan_required?: boolean
          _set_auto_snapshot_enabled?: boolean
          _set_cadence?: boolean
          _set_calculation_key?: boolean
          _set_comment_required?: boolean
          _set_completion_method?: boolean
          _set_description?: boolean
          _set_formula_version?: boolean
          _set_name?: boolean
          _set_source_mode?: boolean
          _set_target_direction?: boolean
          _set_target_value?: boolean
          _set_unit?: boolean
          _set_value_type?: boolean
          _source_mode?: string
          _target_direction?: Database["public"]["Enums"]["kpi_target_direction"]
          _target_value?: number
          _unit?: string
          _value_type?: string
        }
        Returns: Json
      }
      apply_org_site_validation: {
        Args: {
          _code: string
          _connection_id: string
          _note: string
          _site_id?: string
          _site_label_or_name?: string
          _status: string
        }
        Returns: {
          connection_status: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          id: string
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          managed_outside_btpm: boolean
          organization_id: string
          site_id: string | null
          site_label_or_name: string | null
          site_web_url: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sharepoint_org_site_connections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_phase_create: {
        Args: {
          _correlation_id?: string
          _description?: string
          _idempotency_key?: string
          _name: string
          _phase_type?: Database["public"]["Enums"]["phase_type"]
          _project_id: string
          _sort_order?: number
          _start_date?: string
          _status?: Database["public"]["Enums"]["pm_status"]
          _target_end_date?: string
        }
        Returns: Json
      }
      apply_phase_planning_change:
        | {
            Args: {
              _confirm_parent_extension?: boolean
              _expected_updated_at: string
              _new_end: string
              _new_start: string
              _phase_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              _confirm_parent_extension?: boolean
              _new_end: string
              _new_start: string
              _phase_id: string
            }
            Returns: string
          }
      apply_phase_timeline_action: {
        Args: {
          _action: string
          _confirm_project_extension: boolean
          _new_end: string
          _new_start: string
          _phase_id: string
        }
        Returns: Json
      }
      apply_phase_update: {
        Args: {
          _correlation_id?: string
          _description?: string
          _expected_updated_at: string
          _idempotency_key?: string
          _name: string
          _phase_id: string
          _phase_type?: Database["public"]["Enums"]["phase_type"]
          _status?: Database["public"]["Enums"]["pm_status"]
        }
        Returns: Json
      }
      apply_program_create: {
        Args: {
          _correlation_id?: string
          _description?: string
          _idempotency_key?: string
          _name: string
          _workspace_id: string
        }
        Returns: Json
      }
      apply_program_update: {
        Args: {
          _correlation_id?: string
          _description?: string
          _expected_updated_at: string
          _idempotency_key?: string
          _name?: string
          _program_id: string
          _set_description?: boolean
          _status?: Database["public"]["Enums"]["pm_status"]
        }
        Returns: Json
      }
      apply_project_binding_validation: {
        Args: {
          _binding_id: string
          _folder_item_id: string
          _resolved_library_id_or_drive_id: string
          _resolved_library_web_url: string
          _resolved_site_id: string
          _resolved_site_web_url: string
          _status: string
          _validation_code: string
          _validation_note: string
        }
        Returns: {
          binding_mode: Database["public"]["Enums"]["sharepoint_project_binding_mode"]
          binding_status: Database["public"]["Enums"]["sharepoint_project_binding_status"]
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          folder_item_id: string | null
          folder_relative_path: string | null
          folder_web_url: string
          id: string
          is_restricted: boolean
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          organization_id: string
          project_id: string
          resolved_library_id_or_drive_id: string | null
          resolved_library_web_url: string | null
          resolved_site_id: string | null
          resolved_site_web_url: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
          workspace_sharepoint_binding_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sharepoint_project_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_project_create_blank: {
        Args: {
          _correlation_id?: string
          _delivery_model?: Database["public"]["Enums"]["project_delivery_model"]
          _idempotency_key?: string
          _name: string
          _program_id?: string
          _workspace_id: string
        }
        Returns: Json
      }
      apply_project_people_preset: {
        Args: {
          _correlation_id?: string
          _idempotency_key?: string
          _preset_id: string
          _project_id: string
        }
        Returns: Json
      }
      apply_project_planning_change: {
        Args: { _new_end: string; _new_start: string; _project_id: string }
        Returns: undefined
      }
      apply_project_raci_add: {
        Args: {
          _correlation_id?: string
          _idempotency_key?: string
          _project_id: string
          _raci_role: string
          _stakeholder_id?: string
          _user_id?: string
        }
        Returns: Json
      }
      apply_project_raci_remove: {
        Args: {
          _assignment_id: string
          _correlation_id?: string
          _idempotency_key?: string
        }
        Returns: Json
      }
      apply_project_status_transition: {
        Args: {
          _confirm_warnings?: boolean
          _correlation_id?: string
          _expected_updated_at: string
          _idempotency_key?: string
          _project_id: string
          _target_status: Database["public"]["Enums"]["pm_status"]
        }
        Returns: Json
      }
      apply_project_team_member_add: {
        Args: {
          _canonical_role_key?: string
          _correlation_id?: string
          _idempotency_key?: string
          _project_id: string
          _role_label?: string
          _user_id: string
        }
        Returns: Json
      }
      apply_project_team_member_remove: {
        Args: {
          _correlation_id?: string
          _expected_updated_at: string
          _idempotency_key?: string
          _member_id: string
        }
        Returns: Json
      }
      apply_project_team_member_role_update: {
        Args: {
          _canonical_role_key: string
          _correlation_id?: string
          _expected_updated_at: string
          _idempotency_key?: string
          _member_id: string
          _role_label: string
        }
        Returns: Json
      }
      apply_project_update: {
        Args: {
          _assumptions?: string
          _budget_narrative?: string
          _business_case?: string
          _charter?: string
          _completion_criteria?: string
          _constraints?: string
          _correlation_id?: string
          _delivery_model?: Database["public"]["Enums"]["project_delivery_model"]
          _description?: string
          _expected_updated_at: string
          _goals?: string
          _idempotency_key?: string
          _name?: string
          _priority?: Database["public"]["Enums"]["pm_priority"]
          _program_id?: string
          _project_id: string
          _scope_in?: string
          _scope_out?: string
          _set_assumptions?: boolean
          _set_budget_narrative?: boolean
          _set_business_case?: boolean
          _set_charter?: boolean
          _set_completion_criteria?: boolean
          _set_constraints?: boolean
          _set_delivery_model?: boolean
          _set_description?: boolean
          _set_goals?: boolean
          _set_name?: boolean
          _set_priority?: boolean
          _set_program_id?: boolean
          _set_scope_in?: boolean
          _set_scope_out?: boolean
          _set_success_criteria?: boolean
          _success_criteria?: string
        }
        Returns: Json
      }
      apply_risk_create: {
        Args: {
          _correlation_id?: string
          _description?: string
          _idempotency_key?: string
          _impact?: string
          _likelihood?: string
          _mitigation_plan?: string
          _object_links?: Json
          _status?: string
          _target_id: string
          _target_type: string
          _title: string
          _user_links?: Json
        }
        Returns: Json
      }
      apply_risk_update: {
        Args: {
          _correlation_id?: string
          _description?: string
          _expected_updated_at: string
          _idempotency_key?: string
          _impact?: string
          _likelihood?: string
          _mitigation_plan?: string
          _object_links?: Json
          _risk_id: string
          _status?: string
          _title: string
          _user_links?: Json
        }
        Returns: Json
      }
      apply_sprint_create: {
        Args: {
          _correlation_id?: string
          _end_date?: string
          _goal?: string
          _idempotency_key?: string
          _name: string
          _project_id: string
          _start_date?: string
          _status?: string
        }
        Returns: Json
      }
      apply_sprint_update: {
        Args: {
          _correlation_id?: string
          _end_date?: string
          _expected_updated_at: string
          _goal?: string
          _idempotency_key?: string
          _name?: string
          _set_end_date?: boolean
          _set_goal?: boolean
          _set_name?: boolean
          _set_start_date?: boolean
          _set_status?: boolean
          _sprint_id: string
          _start_date?: string
          _status?: string
        }
        Returns: Json
      }
      apply_task_assignee_set: {
        Args: {
          _assignee_id?: string
          _correlation_id?: string
          _idempotency_key?: string
          _task_id: string
        }
        Returns: Json
      }
      apply_task_create: {
        Args: {
          _correlation_id?: string
          _description?: string
          _due_date?: string
          _estimated_hours?: number
          _idempotency_key?: string
          _name: string
          _phase_id: string
          _priority?: Database["public"]["Enums"]["pm_priority"]
          _sort_order?: number
          _start_date?: string
          _status?: Database["public"]["Enums"]["pm_status"]
          _task_type?: Database["public"]["Enums"]["task_type"]
        }
        Returns: Json
      }
      apply_task_execution_change: {
        Args: {
          _actual_end_date?: string
          _actual_start_date?: string
          _correlation_id?: string
          _expected_updated_at: string
          _idempotency_key?: string
          _set_actual_end?: boolean
          _set_actual_start?: boolean
          _status?: Database["public"]["Enums"]["pm_status"]
          _task_id: string
        }
        Returns: Json
      }
      apply_task_planning_change:
        | {
            Args: {
              _confirm_parent_extension?: boolean
              _expected_updated_at: string
              _new_due: string
              _new_start: string
              _task_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              _confirm_parent_extension?: boolean
              _new_due: string
              _new_start: string
              _task_id: string
            }
            Returns: string
          }
      apply_task_stakeholder_roles_set: {
        Args: {
          _correlation_id?: string
          _executor_stakeholder_ids?: string[]
          _expected_updated_at: string
          _idempotency_key?: string
          _requester_stakeholder_id?: string
          _task_id: string
        }
        Returns: Json
      }
      apply_task_update: {
        Args: {
          _correlation_id?: string
          _description?: string
          _estimated_hours?: number
          _expected_updated_at: string
          _idempotency_key?: string
          _name: string
          _priority?: Database["public"]["Enums"]["pm_priority"]
          _status?: Database["public"]["Enums"]["pm_status"]
          _task_id: string
          _task_type?: Database["public"]["Enums"]["task_type"]
        }
        Returns: Json
      }
      apply_workspace_binding_validation: {
        Args: {
          _binding_id: string
          _library_id_or_drive_id: string
          _library_label_or_name: string
          _site_id: string
          _site_label_or_name: string
          _status: string
          _validation_code: string
          _validation_note: string
        }
        Returns: {
          binding_status: Database["public"]["Enums"]["sharepoint_workspace_binding_status"]
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          id: string
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          library_id_or_drive_id: string | null
          library_label_or_name: string | null
          library_web_url: string
          managed_outside_btpm: boolean
          organization_id: string
          site_id: string | null
          site_label_or_name: string | null
          site_web_url: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "sharepoint_workspace_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_project_baseline: {
        Args: { _project_id: string }
        Returns: undefined
      }
      archive_adoption_initiative: {
        Args: { _initiative_id: string }
        Returns: string
      }
      archive_adoption_template: {
        Args: { _template_id: string }
        Returns: string
      }
      archive_ai_instruction_template: {
        Args: { _id: string }
        Returns: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          created_by: string | null
          feature_key: string
          id: string
          instruction_text: string
          notes: string | null
          organization_id: string
          status: string
          title: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ai_instruction_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_backlog_item: { Args: { _id: string }; Returns: undefined }
      archive_board_workflow_state: {
        Args: { _id: string }
        Returns: undefined
      }
      archive_governance_cadence: {
        Args: { _cadence_id: string }
        Returns: undefined
      }
      archive_governance_record: {
        Args: { _record_id: string }
        Returns: undefined
      }
      archive_governance_record_btpm_context_link: {
        Args: { _context_link_id: string }
        Returns: undefined
      }
      archive_governance_record_cross_project_link: {
        Args: { _cross_project_link_id: string }
        Returns: undefined
      }
      archive_governance_record_evidence_file: {
        Args: { _evidence_file_id: string }
        Returns: undefined
      }
      archive_governance_record_evidence_reference: {
        Args: { _evidence_id: string }
        Returns: undefined
      }
      archive_kpi_definition: { Args: { _id: string }; Returns: undefined }
      archive_phase: { Args: { _id: string }; Returns: undefined }
      archive_program: { Args: { _id: string }; Returns: undefined }
      archive_project: { Args: { _id: string }; Returns: undefined }
      archive_project_benefit: {
        Args: { _benefit_id: string }
        Returns: undefined
      }
      archive_project_people_preset: {
        Args: {
          _correlation_id?: string
          _expected_updated_at: string
          _idempotency_key?: string
          _preset_id: string
        }
        Returns: Json
      }
      archive_project_template: { Args: { _id: string }; Returns: undefined }
      archive_roadmap_story_pack: {
        Args: { _story_pack_id: string }
        Returns: undefined
      }
      archive_roadmap_story_presentation_version: {
        Args: { _version_id: string }
        Returns: undefined
      }
      archive_sprint: { Args: { _id: string }; Returns: undefined }
      archive_task: { Args: { _id: string }; Returns: undefined }
      assert_environment_action_allowed: {
        Args: { _action: string; _organization_id: string; _reason?: string }
        Returns: Json
      }
      assert_roadmap_story_pack_editable: {
        Args: { _story_pack_id: string }
        Returns: undefined
      }
      assign_project_portfolio: {
        Args: { _portfolio_item_id?: string; _project_id: string }
        Returns: undefined
      }
      attach_roadmap_story_run_source_snapshot: {
        Args: { _run_id: string; _source_snapshot_json: string }
        Returns: undefined
      }
      auto_accept_pending_invitations: {
        Args: { _user_id: string }
        Returns: number
      }
      bootstrap_organization: {
        Args: { _name: string; _slug: string }
        Returns: string
      }
      bootstrap_organization_for_tenant: {
        Args: {
          _environment_role?: Database["public"]["Enums"]["environment_role"]
          _name: string
          _organization_kind?: Database["public"]["Enums"]["organization_kind"]
          _slug: string
          _tenant_id: string
        }
        Returns: string
      }
      btpm_check_entity_schedule: {
        Args: {
          _id: string
          _new_end: string
          _new_start: string
          _type: string
        }
        Returns: {
          other_end: string
          other_id: string
          other_name: string
          other_start: string
          side: string
        }[]
      }
      btpm_custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      btpm_decrypt: {
        Args: { _ciphertext: string; _org_id: string }
        Returns: string
      }
      btpm_decrypt_tenant_versioned: {
        Args: {
          _ciphertext: string
          _organization_id?: string
          _tenant_id: string
        }
        Returns: string
      }
      btpm_decrypt_v2: {
        Args: {
          _ciphertext: string
          _organization_id: string
          _tenant_id: string
        }
        Returns: string
      }
      btpm_encrypt: {
        Args: { _org_id: string; _plaintext: string }
        Returns: string
      }
      btpm_encrypt_if_legacy: {
        Args: { _organization_id: string; _plaintext: string }
        Returns: string
      }
      btpm_encrypt_tenant_if_plain: {
        Args: { _organization_id: string; _value: string }
        Returns: string
      }
      btpm_encrypt_tenant_versioned: {
        Args: { _plaintext: string; _tenant_id: string }
        Returns: string
      }
      btpm_encrypt_v2: {
        Args: {
          _organization_id: string
          _plaintext: string
          _tenant_id: string
        }
        Returns: string
      }
      btpm_fs_pair_conflict: {
        Args: { _predecessor_end: string; _successor_start: string }
        Returns: boolean
      }
      btpm_get_entity_dates: {
        Args: { _id: string; _type: string }
        Returns: {
          end_date: string
          name: string
          start_date: string
        }[]
      }
      build_tenant_storage_path: {
        Args: {
          _file_name: string
          _object_id: string
          _object_type: string
          _organization_id: string
          _surface: string
          _tenant_id: string
          _workspace_id: string
        }
        Returns: string
      }
      bulk_set_powerbi_workspace_scope: {
        Args: {
          _organization_id: string
          _reason?: string
          _scope_mode: string
          _workspace_ids: string[]
        }
        Returns: number
      }
      can_capture_kpi_snapshot: {
        Args: { _kpi_definition_id: string }
        Returns: boolean
      }
      can_read_demo_or_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      can_read_profile: { Args: { _target_user_id: string }; Returns: boolean }
      can_read_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_read_project_by_target: {
        Args: { _target_id: string; _target_type: string; _user_id: string }
        Returns: boolean
      }
      can_read_project_or_demo: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_roadmap_story_presentation_version: {
        Args: { _user_id: string; _version_id: string }
        Returns: boolean
      }
      can_write_demo: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      check_outbound_email_recent_duplicate: {
        Args: {
          _event_key: string
          _recipient_email: string
          _tenant_id: string
          _window_seconds?: number
        }
        Returns: boolean
      }
      check_tenant_legacy_encryption_key_equivalence: {
        Args: { _tenant_id: string }
        Returns: Json
      }
      claim_next_tenant_background_job: {
        Args: { _job_types?: string[]; _tenant_id: string }
        Returns: {
          attempt_count: number
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          failed_at: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          last_error: string | null
          max_attempts: number
          not_before: string | null
          organization_id: string | null
          payload: Json
          priority: number
          requested_by: string | null
          result: Json | null
          run_as_user_id: string | null
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenant_background_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clone_phase_in_project: {
        Args: {
          _confirm_widening?: boolean
          _new_phase_name: string
          _phase_id: string
          _phase_start_date?: string
        }
        Returns: Json
      }
      clone_task_in_phase: {
        Args: {
          _confirm_widening?: boolean
          _new_task_name: string
          _task_id: string
          _task_start_date?: string
        }
        Returns: Json
      }
      close_governance_decision_case: {
        Args: { _closure_note?: string; _record_id: string }
        Returns: undefined
      }
      commit_btpm_import_v1_core: {
        Args: {
          _dry_run_batch_id: string
          _organization_id: string
          _payload: Json
          _payload_hash: string
          _workspace_id: string
        }
        Returns: Json
      }
      complete_roadmap_story_generation_run: {
        Args: {
          _completion_tokens: number
          _model_metadata: Json
          _prompt_tokens: number
          _raw_output_text?: string
          _run_id: string
          _source_manifest: Json
          _source_snapshot_json: string
          _story_json: string
          _total_tokens: number
        }
        Returns: string
      }
      complete_roadmap_story_presentation_run: {
        Args: {
          _completion_tokens: number
          _is_valid: boolean
          _model_metadata: Json
          _parsed_blueprint_json: string
          _prompt_tokens: number
          _raw_output_text: string
          _run_id: string
          _total_tokens: number
          _validation_json: string
        }
        Returns: undefined
      }
      complete_tenant_background_job: {
        Args: { _job_id: string; _result?: Json }
        Returns: {
          attempt_count: number
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          failed_at: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          last_error: string | null
          max_attempts: number
          not_before: string | null
          organization_id: string | null
          payload: Json
          priority: number
          requested_by: string | null
          result: Json | null
          run_as_user_id: string | null
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenant_background_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_tenant_scheduler_run: {
        Args: {
          _error?: string
          _jobs_enqueued?: number
          _run_id: string
          _status: string
        }
        Returns: {
          completed_at: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          jobs_enqueued: number
          metadata: Json
          scheduler_name: string
          started_at: string
          status: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_scheduler_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_api_rate_limit_v1: {
        Args: { _api_client_id: string; _route_id: string; _user_id: string }
        Returns: {
          allowed: boolean
          effective_limit: number
          effective_window_seconds: number
          remaining: number
          reset_at_epoch_ms: number
        }[]
      }
      create_adoption_initiative: {
        Args: {
          _adoption_plan_id: string
          _name: string
          _owner_id?: string
          _priority?: Database["public"]["Enums"]["pm_priority"]
          _readiness_area: Database["public"]["Enums"]["adoption_readiness_area"]
          _sort_order?: number
          _status?: Database["public"]["Enums"]["adoption_initiative_status"]
          _summary?: string
          _target_date?: string
        }
        Returns: string
      }
      create_adoption_template_from_payload: {
        Args: {
          _description: string
          _name: string
          _payload: Json
          _workspace_id: string
        }
        Returns: string
      }
      create_ai_instruction_template_version: {
        Args: {
          _feature_key: string
          _instruction_text: string
          _notes: string
          _title: string
        }
        Returns: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          created_by: string | null
          feature_key: string
          id: string
          instruction_text: string
          notes: string | null
          organization_id: string
          status: string
          title: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ai_instruction_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_blank_project: {
        Args: {
          _delivery_model?: Database["public"]["Enums"]["project_delivery_model"]
          _name: string
          _program_id?: string
          _workspace_id: string
        }
        Returns: string
      }
      create_blocker_with_links:
        | {
            Args: {
              _description: string
              _object_links?: Json
              _organization_id: string
              _severity: string
              _target_id: string
              _target_type: string
              _title: string
              _user_links?: Json
              _workspace_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              _description: string
              _object_links?: Json
              _organization_id: string
              _severity: string
              _status?: string
              _target_id: string
              _target_type: string
              _title: string
              _user_links?: Json
              _workspace_id: string
            }
            Returns: Json
          }
      create_comment_with_references: {
        Args: {
          _body: string
          _organization_id: string
          _references?: Json
          _target_id: string
          _target_type: string
          _workspace_id: string
        }
        Returns: Json
      }
      create_dependency: {
        Args: {
          _correlation_id?: string
          _idempotency_key?: string
          _source_id: string
          _source_type: string
          _target_id: string
          _target_type: string
        }
        Returns: Json
      }
      create_governance_cadence:
        | {
            Args: {
              _event_name?: string
              _event_type: string
              _expected_evidence_type?: string
              _frequency_type: string
              _next_expected_date?: string
              _owner_id?: string
              _project_id: string
            }
            Returns: string
          }
        | {
            Args: {
              _event_name?: string
              _event_type: string
              _expected_evidence_type?: string
              _frequency_type: string
              _next_expected_date?: string
              _owner_id?: string
              _owner_stakeholder_id?: string
              _project_id: string
            }
            Returns: string
          }
      create_governance_record: {
        Args: {
          _actual_date_held: string
          _cadence_id?: string
          _decision_owner_stakeholder_id?: string
          _decision_question?: string
          _decision_stage?: string
          _decisions_summary?: string
          _event_name?: string
          _event_type: string
          _expected_date_snapshot?: string
          _external_reference_url?: string
          _project_id: string
          _record_kind?: string
          _sharepoint_evidence_reference?: string
          _summary?: string
          _target_decision_date?: string
        }
        Returns: string
      }
      create_governance_record_brief_version: {
        Args: {
          _edited_brief_text?: string
          _executive_intro_text?: string
          _guardrails_text?: string
          _make_current?: boolean
          _options_summary?: string
          _raw_copilot_output?: string
          _recommendation_text?: string
          _record_id: string
          _requested_decision_text?: string
          _residual_risks_text?: string
          _source_type?: string
        }
        Returns: Json
      }
      create_governance_record_btpm_context_link: {
        Args: {
          _context_reason?: string
          _included_in_package?: boolean
          _object_id: string
          _object_type: string
          _record_id: string
          _relationship_type?: string
          _relevance_level?: string
          _source_project_id: string
        }
        Returns: string
      }
      create_governance_record_cross_project_link: {
        Args: {
          _included_in_package?: boolean
          _linked_project_id: string
          _record_id: string
          _relationship_reason?: string
          _relationship_type: string
          _source_dependency_id?: string
        }
        Returns: string
      }
      create_governance_record_evidence_reference: {
        Args: {
          _evidence_date?: string
          _evidence_type: string
          _external_url: string
          _included_in_package?: boolean
          _owner_stakeholder_id?: string
          _record_id: string
          _relevance_level?: string
          _summary?: string
          _title: string
        }
        Returns: string
      }
      create_governance_record_stakeholder_package: {
        Args: {
          _audience_text?: string
          _background_context?: string
          _decision_ask_text?: string
          _decision_question_text?: string
          _distribution_evidence_url?: string
          _distribution_note?: string
          _evidence_summary?: string
          _executive_summary?: string
          _guardrails_text?: string
          _make_current?: boolean
          _next_steps_text?: string
          _options_summary?: string
          _package_status?: string
          _package_title: string
          _recommendation_text?: string
          _record_id: string
          _residual_risks_text?: string
        }
        Returns: Json
      }
      create_project_adoption_plan: {
        Args: {
          _adoption_owner_id?: string
          _approach_summary?: string
          _created_from_template?: boolean
          _impacted_audience_summary?: string
          _objective?: string
          _project_id: string
          _readiness_status?: Database["public"]["Enums"]["adoption_readiness_status"]
        }
        Returns: string
      }
      create_project_benefit: {
        Args: {
          _actual_realization_date?: string
          _actual_value?: number
          _baseline_value?: number
          _benefit_owner_id?: string
          _benefit_type: string
          _custom_benefit_type_label?: string
          _description?: string
          _evidence_note?: string
          _expected_realization_date?: string
          _metric_name: string
          _project_id: string
          _realization_status?: string
          _target_value: number
          _unit_of_measure: string
        }
        Returns: string
      }
      create_risk_with_links: {
        Args: {
          _description: string
          _impact: string
          _likelihood: string
          _mitigation_plan: string
          _object_links?: Json
          _organization_id: string
          _status: string
          _target_id: string
          _target_type: string
          _title: string
          _user_links?: Json
          _workspace_id: string
        }
        Returns: Json
      }
      create_roadmap_story_pack: {
        Args: {
          _audience?: string
          _focus?: string
          _guidance?: string
          _primary_workspace_id?: string
          _program_id?: string
          _scope_config?: Json
          _source_config?: Json
          _title?: string
        }
        Returns: string
      }
      create_workspace: {
        Args: { _description?: string; _name: string }
        Returns: string
      }
      create_workspace_in_organization: {
        Args: { _description?: string; _name: string; _organization_id: string }
        Returns: string
      }
      deactivate_workspace: {
        Args: { _workspace_id: string }
        Returns: undefined
      }
      delete_roadmap_story_pack_note: {
        Args: { _note_id: string }
        Returns: undefined
      }
      delete_user_saved_view: { Args: { _id: string }; Returns: undefined }
      disable_sharepoint_org_site: {
        Args: { _connection_id: string }
        Returns: {
          connection_status: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          id: string
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          managed_outside_btpm: boolean
          organization_id: string
          site_id: string | null
          site_label_or_name: string | null
          site_web_url: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sharepoint_org_site_connections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      disable_sharepoint_project_binding: {
        Args: { _binding_id: string }
        Returns: {
          binding_mode: Database["public"]["Enums"]["sharepoint_project_binding_mode"]
          binding_status: Database["public"]["Enums"]["sharepoint_project_binding_status"]
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          folder_item_id: string | null
          folder_relative_path: string | null
          folder_web_url: string
          id: string
          is_restricted: boolean
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          organization_id: string
          project_id: string
          resolved_library_id_or_drive_id: string | null
          resolved_library_web_url: string | null
          resolved_site_id: string | null
          resolved_site_web_url: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
          workspace_sharepoint_binding_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sharepoint_project_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      disable_sharepoint_workspace_binding: {
        Args: { _binding_id: string }
        Returns: {
          binding_status: Database["public"]["Enums"]["sharepoint_workspace_binding_status"]
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          id: string
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          library_id_or_drive_id: string | null
          library_label_or_name: string | null
          library_web_url: string
          managed_outside_btpm: boolean
          organization_id: string
          site_id: string | null
          site_label_or_name: string | null
          site_web_url: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "sharepoint_workspace_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_tenant_background_job: {
        Args: {
          _idempotency_key?: string
          _job_type: string
          _max_attempts?: number
          _not_before?: string
          _organization_id?: string
          _payload?: Json
          _priority?: number
          _run_as_user_id?: string
          _tenant_id: string
          _workspace_id?: string
        }
        Returns: {
          attempt_count: number
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          failed_at: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          last_error: string | null
          max_attempts: number
          not_before: string | null
          organization_id: string | null
          payload: Json
          priority: number
          requested_by: string | null
          result: Json | null
          run_as_user_id: string | null
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenant_background_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_active_tenant_encryption_key_version: {
        Args: { _tenant_id: string }
        Returns: Json
      }
      ensure_org_encryption_key: {
        Args: { _org_id: string }
        Returns: undefined
      }
      ensure_organization_encryption_metadata: {
        Args: { _organization_id: string }
        Returns: undefined
      }
      ensure_tenant_encryption_key_v1_from_legacy: {
        Args: { _tenant_id: string }
        Returns: Json
      }
      ensure_user_profile: { Args: never; Returns: undefined }
      fail_roadmap_story_generation_run: {
        Args: { _error_text: string; _run_id: string }
        Returns: undefined
      }
      fail_roadmap_story_presentation_run: {
        Args: { _error_text: string; _run_id: string }
        Returns: undefined
      }
      fail_tenant_background_job: {
        Args: { _dead_letter?: boolean; _error: string; _job_id: string }
        Returns: {
          attempt_count: number
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          failed_at: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          last_error: string | null
          max_attempts: number
          not_before: string | null
          organization_id: string | null
          payload: Json
          priority: number
          requested_by: string | null
          result: Json | null
          run_as_user_id: string | null
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenant_background_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_project_adoption_plan_from_saved_template: {
        Args: {
          _phase_end_date?: string
          _phase_name?: string
          _phase_start_date?: string
          _project_id: string
          _selection?: Json
          _template_id?: string
          _template_key?: string
        }
        Returns: Json
      }
      generate_project_adoption_plan_from_template: {
        Args: {
          _create_phase?: boolean
          _phase_end_date?: string
          _phase_name?: string
          _phase_start_date?: string
          _project_id: string
          _selection?: Json
        }
        Returns: Json
      }
      get_accessible_roadmap_story_published_versions: {
        Args: { _limit?: number; _query?: string }
        Returns: {
          is_owner: boolean
          presentation_id: string
          published_at: string
          published_by: string
          source_project_count: number
          status: string
          story_pack_id: string
          title: string
          version_id: string
          version_number: number
        }[]
      }
      get_active_ai_instruction_template: {
        Args: { _feature_key: string }
        Returns: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          created_by: string | null
          feature_key: string
          id: string
          instruction_text: string
          notes: string | null
          organization_id: string
          status: string
          title: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ai_instruction_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_active_ai_instruction_template_for_org: {
        Args: { _feature_key: string; _organization_id: string }
        Returns: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          created_by: string | null
          feature_key: string
          id: string
          instruction_text: string
          notes: string | null
          organization_id: string
          status: string
          title: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ai_instruction_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_admin_user_detail: {
        Args: { _organization_id: string; _user_id: string }
        Returns: Json
      }
      get_ai_feature_settings: {
        Args: never
        Returns: {
          created_at: string
          enabled: boolean
          feature_key: string
          id: string
          max_files_per_request: number | null
          max_individual_file_mb: number | null
          max_total_file_mb: number | null
          model_registry_id: string
          organization_id: string
          provider: string
          reasoning_effort: string | null
          require_user_confirmation: boolean
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "ai_feature_settings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_api_d_consent_context: {
        Args: { _client_key: string }
        Returns: Json
      }
      get_api_d_oauth_consent_gate: {
        Args: { _oauth_client_id: string }
        Returns: Json
      }
      get_comment_mention_email_status: {
        Args: { _target_id: string; _target_type: string }
        Returns: {
          comment_id: string
          failed_count: number
          pending_count: number
          sent_count: number
          skipped_count: number
          status: string
          total_count: number
        }[]
      }
      get_decrypted_knowledge_article: {
        Args: { _id: string }
        Returns: {
          archived_at: string
          article_type: Database["public"]["Enums"]["knowledge_article_type"]
          body: string
          category_id: string
          created_at: string
          id: string
          organization_id: string
          owner_id: string
          published_at: string
          related_object_id: string
          related_object_type: string
          related_route: string
          slug: string
          status: Database["public"]["Enums"]["knowledge_article_status"]
          summary: string
          title: string
          tooltip_excerpt: string
          updated_at: string
          version: number
          visibility: Database["public"]["Enums"]["knowledge_article_visibility"]
          workspace_id: string
        }[]
      }
      get_decrypted_phase: { Args: { _phase_id: string }; Returns: Json }
      get_decrypted_profile: { Args: { _user_id?: string }; Returns: Json }
      get_decrypted_program: { Args: { _program_id: string }; Returns: Json }
      get_decrypted_project: { Args: { _project_id: string }; Returns: Json }
      get_decrypted_project_closure_summary: {
        Args: { _project_id: string }
        Returns: {
          achievements_summary: string
          benefits_summary: string
          created_at: string
          created_by: string
          id: string
          open_items_summary: string
          organization_id: string
          outcome_summary: string
          project_id: string
          transition_notes: string
          updated_at: string
          updated_by: string
          workspace_id: string
        }[]
      }
      get_decrypted_project_lessons_learned_document: {
        Args: { _project_id: string }
        Returns: {
          created_at: string
          created_by: string
          created_in_sharepoint_at: string
          document_name: string
          id: string
          last_modified_at: string
          metadata_refreshed_at: string
          organization_id: string
          project_id: string
          sharepoint_drive_id: string
          sharepoint_item_id: string
          sharepoint_web_url: string
          status: string
          updated_at: string
          workspace_id: string
        }[]
      }
      get_decrypted_task: { Args: { _task_id: string }; Returns: Json }
      get_decrypted_workspace: {
        Args: { _workspace_id: string }
        Returns: Json
      }
      get_environment_safety_profile: {
        Args: { _organization_id: string }
        Returns: Json
      }
      get_governance_decision_case_project_summary: {
        Args: { _record_id: string }
        Returns: Json
      }
      get_governance_record_decision_outcome: {
        Args: { _record_id: string }
        Returns: Json
      }
      get_governance_record_detail: {
        Args: { _record_id: string }
        Returns: Json
      }
      get_kpi_app_mapping_admin: {
        Args: { _mapping_id: string }
        Returns: Json
      }
      get_kpi_app_outbox_admin: { Args: { _outbox_id: string }; Returns: Json }
      get_kpi_app_payload_source: {
        Args: { _outbox_id: string }
        Returns: Json
      }
      get_kpi_snapshot_decrypted_for_mapping: {
        Args: { _mapping_id: string; _snapshot_id: string }
        Returns: Json
      }
      get_kpi_snapshot_decrypted_for_mapping_system: {
        Args: { _mapping_id: string; _snapshot_id: string }
        Returns: Json
      }
      get_latest_manual_kpi_value: {
        Args: { _kpi_definition_id: string }
        Returns: Json
      }
      get_latest_roadmap_story_pack_version_content: {
        Args: { _story_pack_id: string }
        Returns: Json
      }
      get_latest_roadmap_story_presentation_blueprint: {
        Args: { _story_pack_id: string }
        Returns: Json
      }
      get_my_active_context: { Args: never; Returns: Json }
      get_my_admin_access_summary: { Args: never; Returns: Json }
      get_org_user_display_name: { Args: { _user_id: string }; Returns: string }
      get_org_users_list: {
        Args: { _organization_id: string }
        Returns: {
          display_name: string
          email: string
          invitation_state: string
          invitation_workspace_name: string
          org_role: string
          row_kind: string
          status: string
          user_id: string
          workspace_count: number
          workspace_names: string[]
        }[]
      }
      get_organization_tenant_id: {
        Args: { _organization_id: string }
        Returns: string
      }
      get_portfolio_benefits_realization: {
        Args: {
          _benefit_types?: string[]
          _expected_from?: string
          _expected_to?: string
          _include_archived?: boolean
          _include_no_portfolio?: boolean
          _portfolio_item_ids?: string[]
          _program_ids?: string[]
          _project_ids?: string[]
          _project_manager_ids?: string[]
          _project_statuses?: string[]
          _realization_statuses?: string[]
          _workspace_ids?: string[]
        }
        Returns: Json
      }
      get_portfolio_item_project_membership_summary: {
        Args: {
          _include_archived_projects?: boolean
          _portfolio_item_id: string
        }
        Returns: Json
      }
      get_powerbi_data_scope: {
        Args: { _organization_id: string }
        Returns: Json
      }
      get_powerbi_effective_scope: {
        Args: { _organization_id: string }
        Returns: {
          included_project_ids: string[]
          included_workspace_ids: string[]
          scope_configured: boolean
        }[]
      }
      get_project_execution_update_digest_for_snapshot_system: {
        Args: {
          _limit?: number
          _period_end: string
          _period_start: string
          _project_id: string
        }
        Returns: Json
      }
      get_project_execution_update_digest_for_snapshot_system_v2: {
        Args: {
          _allowed_target_types?: string[]
          _limit?: number
          _period_end: string
          _period_start: string
          _project_id: string
        }
        Returns: Json
      }
      get_project_governance_summary: {
        Args: { _project_id: string }
        Returns: Json
      }
      get_project_people_preset: { Args: { _preset_id: string }; Returns: Json }
      get_project_template_detail: {
        Args: { _template_id: string }
        Returns: Json
      }
      get_roadmap_story_pack_ai_run_status: {
        Args: { _run_id: string }
        Returns: Json
      }
      get_roadmap_story_pack_config: {
        Args: { _story_pack_id: string }
        Returns: Json
      }
      get_roadmap_story_pack_version_debug: {
        Args: { _version_id: string }
        Returns: Json
      }
      get_roadmap_story_pack_visual_settings: {
        Args: { _story_pack_id: string }
        Returns: Json
      }
      get_roadmap_story_presentation_debug: {
        Args: { _run_id: string }
        Returns: Json
      }
      get_roadmap_story_presentation_run_status: {
        Args: { _run_id: string }
        Returns: Json
      }
      get_roadmap_story_presentation_version_access_scope: {
        Args: { _version_id: string }
        Returns: {
          project_id: string
          workspace_id: string
        }[]
      }
      get_roadmap_story_presentation_version_for_view: {
        Args: { _version_id: string }
        Returns: Json
      }
      get_roadmap_story_presentation_versions: {
        Args: { _story_pack_id: string }
        Returns: {
          archived_at: string
          presentation_id: string
          published_at: string
          published_by: string
          source_project_count: number
          status: string
          title: string
          version_id: string
          version_number: number
          viewer_can_open: boolean
        }[]
      }
      get_sharepoint_org_site: {
        Args: { _organization_id: string }
        Returns: {
          connection_status: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          id: string
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          managed_outside_btpm: boolean
          organization_id: string
          site_id: string | null
          site_label_or_name: string | null
          site_web_url: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sharepoint_org_site_connections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_sharepoint_project_binding: {
        Args: { _project_id: string }
        Returns: {
          binding_mode: Database["public"]["Enums"]["sharepoint_project_binding_mode"]
          binding_status: Database["public"]["Enums"]["sharepoint_project_binding_status"]
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          folder_item_id: string | null
          folder_relative_path: string | null
          folder_web_url: string
          id: string
          is_restricted: boolean
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          organization_id: string
          project_id: string
          resolved_library_id_or_drive_id: string | null
          resolved_library_web_url: string | null
          resolved_site_id: string | null
          resolved_site_web_url: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
          workspace_sharepoint_binding_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sharepoint_project_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_sharepoint_workspace_binding: {
        Args: { _workspace_id: string }
        Returns: {
          binding_status: Database["public"]["Enums"]["sharepoint_workspace_binding_status"]
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          id: string
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          library_id_or_drive_id: string | null
          library_label_or_name: string | null
          library_web_url: string
          managed_outside_btpm: boolean
          organization_id: string
          site_id: string | null
          site_label_or_name: string | null
          site_web_url: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "sharepoint_workspace_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_team_work_overview: {
        Args: {
          _assignee_id?: string
          _include_completed?: boolean
          _portfolio_item_ids?: string[]
          _program_id?: string
          _project_id?: string
          _time_window?: string
          _workspace_id?: string
          _workspace_ids?: string[]
        }
        Returns: Json
      }
      get_tenant_protected_download_context: {
        Args: { _storage_object_id: string }
        Returns: Json
      }
      get_user_org_id: { Args: { _user_id: string }; Returns: string }
      hard_delete_backlog_item: { Args: { _id: string }; Returns: undefined }
      hard_delete_board_workflow_state: {
        Args: { _id: string }
        Returns: undefined
      }
      hard_delete_governance_cadence: {
        Args: { _cadence_id: string }
        Returns: undefined
      }
      hard_delete_governance_record: {
        Args: { _record_id: string }
        Returns: undefined
      }
      hard_delete_kpi_definition: { Args: { _id: string }; Returns: undefined }
      hard_delete_phase: {
        Args: { _id: string }
        Returns: {
          bucket: string
          storage_path: string
        }[]
      }
      hard_delete_program: { Args: { _id: string }; Returns: undefined }
      hard_delete_project: {
        Args: { _id: string }
        Returns: {
          bucket: string
          storage_path: string
        }[]
      }
      hard_delete_project_template: {
        Args: { _id: string }
        Returns: undefined
      }
      hard_delete_sprint: { Args: { _id: string }; Returns: undefined }
      hard_delete_task: {
        Args: { _id: string }
        Returns: {
          bucket: string
          storage_path: string
        }[]
      }
      has_pm_authority: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      has_project_access: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      has_project_access_by_kpi_def: {
        Args: { _kpi_definition_id: string; _user_id: string }
        Returns: boolean
      }
      has_project_access_by_target: {
        Args: { _target_id: string; _target_type: string; _user_id: string }
        Returns: boolean
      }
      has_project_pm_authority: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      has_project_pm_authority_by_kpi_def: {
        Args: { _kpi_definition_id: string; _user_id: string }
        Returns: boolean
      }
      has_project_pm_authority_by_target: {
        Args: { _target_id: string; _target_type: string; _user_id: string }
        Returns: boolean
      }
      has_project_role: {
        Args: {
          _project_id: string
          _role: Database["public"]["Enums"]["project_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_workspace_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
          _workspace_id: string
        }
        Returns: boolean
      }
      instantiate_project_from_template: {
        Args: {
          _confirm_widening?: boolean
          _delivery_model?: Database["public"]["Enums"]["project_delivery_model"]
          _new_project_name: string
          _program_id?: string
          _project_start_date?: string
          _template_id: string
        }
        Returns: Json
      }
      is_active_user: { Args: { _user_id: string }; Returns: boolean }
      is_decision_cases_ai_enabled: { Args: never; Returns: boolean }
      is_demo_workspace: { Args: { _workspace_id: string }; Returns: boolean }
      is_org_admin: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_organization_admin: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: boolean
      }
      is_organization_member: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: boolean
      }
      is_platform_super_admin: { Args: { _user_id?: string }; Returns: boolean }
      is_project_completed: { Args: { _project_id: string }; Returns: boolean }
      is_story_pack_owner: {
        Args: { _story_pack_id: string; _user_id: string }
        Returns: boolean
      }
      is_tenant_admin: {
        Args: { _tenant_id: string; _user_id?: string }
        Returns: boolean
      }
      is_tenant_member: {
        Args: { _tenant_id: string; _user_id?: string }
        Returns: boolean
      }
      is_tenant_owner: {
        Args: { _tenant_id: string; _user_id?: string }
        Returns: boolean
      }
      is_user_org_admin: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_user_org_member: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_user_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      is_workspace_admin_or_higher: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      kc_admin_archive_article: { Args: { _id: string }; Returns: undefined }
      kc_admin_create_article: {
        Args: {
          _article_type?: Database["public"]["Enums"]["knowledge_article_type"]
          _body?: string
          _category_id: string
          _owner_id?: string
          _related_object_id?: string
          _related_object_type?: string
          _related_route?: string
          _slug: string
          _summary?: string
          _title: string
          _tooltip_excerpt?: string
          _visibility?: Database["public"]["Enums"]["knowledge_article_visibility"]
          _workspace_id?: string
        }
        Returns: string
      }
      kc_admin_create_category: {
        Args: {
          _description?: string
          _name: string
          _slug: string
          _sort_order?: number
        }
        Returns: string
      }
      kc_admin_publish_article: { Args: { _id: string }; Returns: undefined }
      kc_admin_unarchive_article: { Args: { _id: string }; Returns: undefined }
      kc_admin_update_article: {
        Args: {
          _article_type?: Database["public"]["Enums"]["knowledge_article_type"]
          _body?: string
          _category_id?: string
          _id: string
          _owner_id?: string
          _related_object_id?: string
          _related_object_type?: string
          _related_route?: string
          _slug?: string
          _summary?: string
          _title?: string
          _tooltip_excerpt?: string
          _visibility?: Database["public"]["Enums"]["knowledge_article_visibility"]
          _workspace_id?: string
        }
        Returns: undefined
      }
      kc_admin_update_category: {
        Args: {
          _description?: string
          _id: string
          _is_active?: boolean
          _name?: string
          _slug?: string
          _sort_order?: number
        }
        Returns: undefined
      }
      kpi_scheduler_diagnostics: {
        Args: never
        Returns: {
          active: boolean
          expected_jobname: string
          job_configured: boolean
          jobid: number
          last_run_finished_at: string
          last_run_return_message: string
          last_run_started_at: string
          last_run_status: string
          schedule: string
        }[]
      }
      link_adoption_object: {
        Args: {
          _adoption_initiative_id?: string
          _adoption_plan_id: string
          _object_id: string
          _object_type: string
        }
        Returns: string
      }
      link_task_to_adoption: {
        Args: { _adoption_initiative_id?: string; _task_id: string }
        Returns: string
      }
      list_active_portfolio_items_for_project_picker: {
        Args: { _project_id: string }
        Returns: Json
      }
      list_active_portfolio_items_for_workspace_picker: {
        Args: { _workspace_id: string }
        Returns: Json
      }
      list_adoption_templates: {
        Args: { _workspace_id: string }
        Returns: Json
      }
      list_ai_instruction_templates: {
        Args: { _feature_key: string }
        Returns: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          created_by: string | null
          feature_key: string
          id: string
          instruction_text: string
          notes: string | null
          organization_id: string
          status: string
          title: string
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "ai_instruction_templates"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_ai_model_registry: {
        Args: never
        Returns: {
          active: boolean
          capability_tier: string
          created_at: string
          display_name: string
          id: string
          model_id: string
          provider: string
          recommended_for_decision_cases: boolean
          recommended_for_guide: boolean
          recommended_for_roadmap_story: boolean
          sort_order: number
          supports_file_input: boolean
          supports_structured_output: boolean
          supports_vision: boolean
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ai_model_registry"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_decision_case_ai_runs: {
        Args: { _record_id: string }
        Returns: Json
      }
      list_decrypted_activity_events: {
        Args: { _target_id: string; _target_type: string }
        Returns: Json
      }
      list_decrypted_backlog_items: {
        Args: { _project_id: string }
        Returns: Json
      }
      list_decrypted_blockers: {
        Args: { _target_id: string; _target_type: string }
        Returns: Json
      }
      list_decrypted_comments: {
        Args: { _target_id: string; _target_type: string }
        Returns: Json
      }
      list_decrypted_execution_updates: {
        Args: { _target_id: string; _target_type: string }
        Returns: Json
      }
      list_decrypted_knowledge_articles: {
        Args: { _category_id?: string; _include_unpublished?: boolean }
        Returns: {
          archived_at: string
          article_type: Database["public"]["Enums"]["knowledge_article_type"]
          category_id: string
          created_at: string
          id: string
          organization_id: string
          owner_id: string
          published_at: string
          related_object_id: string
          related_object_type: string
          related_route: string
          slug: string
          status: Database["public"]["Enums"]["knowledge_article_status"]
          summary: string
          title: string
          tooltip_excerpt: string
          updated_at: string
          version: number
          visibility: Database["public"]["Enums"]["knowledge_article_visibility"]
          workspace_id: string
        }[]
      }
      list_decrypted_knowledge_categories: {
        Args: never
        Returns: {
          created_at: string
          description: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          slug: string
          sort_order: number
          updated_at: string
        }[]
      }
      list_decrypted_kpi_definitions: {
        Args: { _project_id: string }
        Returns: Json
      }
      list_decrypted_kpi_snapshots: {
        Args: { _kpi_definition_id?: string; _project_id: string }
        Returns: Json
      }
      list_decrypted_kpi_updates: {
        Args: { _kpi_definition_id: string }
        Returns: Json
      }
      list_decrypted_program_projects: {
        Args: { _program_id: string }
        Returns: Json
      }
      list_decrypted_project_benefits: {
        Args: { _include_archived?: boolean; _project_id: string }
        Returns: {
          actual_realization_date: string
          actual_value: number
          archived_at: string
          baseline_value: number
          benefit_owner_display_name: string
          benefit_owner_email: string
          benefit_owner_id: string
          benefit_type: string
          created_at: string
          created_by: string
          custom_benefit_type_label: string
          description: string
          evidence_note: string
          expected_realization_date: string
          id: string
          metric_name: string
          organization_id: string
          project_id: string
          realization_status: string
          target_value: number
          unit_of_measure: string
          updated_at: string
          updated_by: string
          workspace_id: string
        }[]
      }
      list_decrypted_project_phases: {
        Args: { _project_id: string }
        Returns: Json
      }
      list_decrypted_project_tasks: {
        Args: { _project_id: string }
        Returns: Json
      }
      list_decrypted_project_team: {
        Args: { _project_id: string }
        Returns: Json
      }
      list_decrypted_risks: {
        Args: { _target_id: string; _target_type: string }
        Returns: Json
      }
      list_decrypted_sprints: { Args: { _project_id: string }; Returns: Json }
      list_decrypted_workflow_states: {
        Args: { _project_id: string }
        Returns: Json
      }
      list_decrypted_workspace_programs: {
        Args: { _workspace_id: string }
        Returns: Json
      }
      list_entity_dependencies: {
        Args: { _entity_id: string; _entity_type: string }
        Returns: {
          created_at: string
          created_by: string | null
          dependency_type: Database["public"]["Enums"]["dependency_type"]
          description: string | null
          id: string
          organization_id: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "dependencies"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_entity_links: {
        Args: { _owner_ids: string[]; _owner_type: string }
        Returns: Json
      }
      list_generated_decision_case_documents: {
        Args: {
          _document_type?: Database["public"]["Enums"]["generated_doc_type"]
          _record_id: string
        }
        Returns: Json
      }
      list_governance_record_brief_versions: {
        Args: { _record_id: string }
        Returns: Json
      }
      list_governance_record_btpm_context_links: {
        Args: { _include_archived?: boolean; _record_id: string }
        Returns: Json
      }
      list_governance_record_copilot_data_packages: {
        Args: { _record_id: string }
        Returns: Json
      }
      list_governance_record_cross_project_links: {
        Args: { _include_archived?: boolean; _record_id: string }
        Returns: Json
      }
      list_governance_record_evidence_files: {
        Args: { _include_archived?: boolean; _record_id: string }
        Returns: Json
      }
      list_governance_record_evidence_references: {
        Args: { _include_archived?: boolean; _record_id: string }
        Returns: Json
      }
      list_governance_record_stakeholder_packages: {
        Args: { _record_id: string }
        Returns: Json
      }
      list_knowledge_article_ai_metadata_for_visible_articles: {
        Args: { _article_ids: string[] }
        Returns: {
          ai_flow: string
          answer_rules: string[]
          article_id: string
          audience: string[]
          feature_area: string[]
          forbidden_claims: string[]
          freshness_label: string
          question_examples: string[]
          related_feature_flags: string[]
          route_patterns: string[]
          synonyms: string[]
          updated_at: string
          user_intents: string[]
          workflow_metadata: Json
        }[]
      }
      list_my_organizations_for_tenant: {
        Args: { _tenant_id: string }
        Returns: {
          environment_role: Database["public"]["Enums"]["environment_role"]
          name: string
          organization_id: string
          organization_kind: Database["public"]["Enums"]["organization_kind"]
          role: Database["public"]["Enums"]["organization_role"]
          slug: string
        }[]
      }
      list_my_tenants: {
        Args: never
        Returns: {
          name: string
          role: Database["public"]["Enums"]["tenant_role"]
          slug: string
          tenant_id: string
        }[]
      }
      list_my_workspaces_for_organization: {
        Args: { _organization_id: string }
        Returns: {
          is_active: boolean
          is_archived: boolean
          is_demo: boolean
          name: string
          workspace_id: string
        }[]
      }
      list_project_activity_events: {
        Args: { _project_id: string }
        Returns: Json
      }
      list_project_adoption_reporting_summaries: {
        Args: { _project_ids?: string[]; _workspace_id: string }
        Returns: Json
      }
      list_project_adoption_substrate: {
        Args: { _project_id: string }
        Returns: Json
      }
      list_project_all_blockers: {
        Args: { _project_id: string }
        Returns: Json
      }
      list_project_all_risks: { Args: { _project_id: string }; Returns: Json }
      list_project_governance_cadences: {
        Args: { _include_archived?: boolean; _project_id: string }
        Returns: Json
      }
      list_project_governance_records: {
        Args: { _include_archived?: boolean; _project_id: string }
        Returns: Json
      }
      list_project_people_presets: {
        Args: { _include_archived?: boolean; _workspace_id: string }
        Returns: {
          archived_at: string
          archived_by: string
          created_at: string
          created_by: string
          created_by_name: string
          description: string
          id: string
          member_count: number
          name: string
          organization_id: string
          stakeholder_count: number
          team_count: number
          updated_at: string
          workspace_id: string
        }[]
      }
      list_project_raci: { Args: { _project_id: string }; Returns: Json }
      list_project_reporting_summaries: {
        Args: {
          _include_demo?: boolean
          _project_ids?: string[]
          _workspace_id: string
        }
        Returns: Json
      }
      list_project_stakeholders: {
        Args: { _project_id: string }
        Returns: {
          created_at: string
          created_by: string
          created_by_name: string
          display_name: string
          external_name: string
          id: string
          notes: string
          removed_at: string
          removed_by: string
          removed_by_name: string
          role_label: string
          stakeholder_type: string
          start_date: string
          updated_at: string
          user_id: string
        }[]
      }
      list_project_templates: {
        Args: { _include_archived?: boolean; _workspace_id: string }
        Returns: Json[]
      }
      list_roadmap_calendar_markers: {
        Args: { _project_ids: string[] }
        Returns: Json
      }
      list_roadmap_story_pack_included_files: {
        Args: { _story_pack_id: string }
        Returns: {
          display_name: string
          drive_id: string
          id: string
          include_in_story: boolean
          item_id: string
          mime_type: string
          size_bytes: number
          web_url: string
        }[]
      }
      list_roadmap_story_packs: {
        Args: { _include_archived?: boolean }
        Returns: Json
      }
      list_sharepoint_workspace_bindings: {
        Args: { _organization_id: string }
        Returns: {
          binding_status: Database["public"]["Enums"]["sharepoint_workspace_binding_status"]
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          id: string
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          library_id_or_drive_id: string | null
          library_label_or_name: string | null
          library_web_url: string
          managed_outside_btpm: boolean
          organization_id: string
          site_id: string | null
          site_label_or_name: string | null
          site_web_url: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "sharepoint_workspace_bindings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_user_saved_views: {
        Args: { _scope_key?: string; _surface_key: string }
        Returns: Json
      }
      list_user_workspaces: { Args: never; Returns: Json }
      list_workspace_projects: {
        Args: { _include_archived?: boolean; _workspace_id: string }
        Returns: Json
      }
      log_activity_event: {
        Args: {
          _actor_id: string
          _event_type: string
          _metadata?: Json
          _organization_id: string
          _target_id: string
          _target_type: string
          _workspace_id?: string
        }
        Returns: string
      }
      mark_decision_case_ai_run_discarded: {
        Args: { _ai_run_id: string }
        Returns: undefined
      }
      mark_governance_record_copilot_data_package_downloaded: {
        Args: { _package_id: string }
        Returns: undefined
      }
      mark_governance_record_stakeholder_package_provided: {
        Args: {
          _distribution_evidence_url?: string
          _distribution_note?: string
          _package_id: string
        }
        Returns: undefined
      }
      mcp_v1_append_execution_update: {
        Args: {
          _correlation_id: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _payload_hash: string
          _request_id: string
          _status_label: string
          _summary: string
          _target_id: string
          _target_type: string
          _update_date: string
        }
        Returns: Json
      }
      mcp_v1_append_kpi_update: {
        Args: {
          _correlation_id: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _kpi_definition_id: string
          _note: string
          _payload_hash: string
          _request_id: string
          _update_date: string
          _value: number
        }
        Returns: Json
      }
      mcp_v1_assign_project_portfolio: {
        Args: {
          _correlation_id: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _payload_hash: string
          _portfolio_item_id: string
          _project_id: string
          _request_id: string
        }
        Returns: Json
      }
      mcp_v1_assign_task: {
        Args: {
          _assignee_id: string
          _correlation_id: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _payload_hash: string
          _request_id: string
          _task_id: string
        }
        Returns: Json
      }
      mcp_v1_create_blocker: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _payload_hash: string
          _request_id: string
          _severity: string
          _status: string
          _target_id: string
          _target_type: string
          _title: string
        }
        Returns: Json
      }
      mcp_v1_create_kpi: {
        Args: {
          _action_plan_required: boolean
          _auto_snapshot_enabled: boolean
          _cadence: string
          _calculation_key: string
          _comment_required: boolean
          _completion_method: string
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _formula_version: number
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _project_id: string
          _request_id: string
          _source_mode: string
          _target_direction: string
          _target_value: number
          _unit: string
          _value_type: string
        }
        Returns: Json
      }
      mcp_v1_create_phase: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _phase_type: string
          _project_id: string
          _request_id: string
          _sort_order: number
          _start_date: string
          _status: string
          _target_end_date: string
        }
        Returns: Json
      }
      mcp_v1_create_portfolio: {
        Args: {
          _code: string
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _lifecycle_state: string
          _name: string
          _organization_id: string
          _owner_id: string
          _payload_hash: string
          _request_id: string
          _strategic_priority: string
        }
        Returns: Json
      }
      mcp_v1_create_program: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _request_id: string
          _workspace_id: string
        }
        Returns: Json
      }
      mcp_v1_create_project: {
        Args: {
          _correlation_id: string
          _delivery_model: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _program_id: string
          _request_id: string
          _workspace_id: string
        }
        Returns: Json
      }
      mcp_v1_create_risk: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _impact: string
          _likelihood: string
          _mitigation_plan: string
          _payload_hash: string
          _request_id: string
          _status: string
          _target_id: string
          _target_type: string
          _title: string
        }
        Returns: Json
      }
      mcp_v1_create_task: {
        Args: {
          _correlation_id: string
          _description: string
          _due_date: string
          _estimated_hours: number
          _expected_oauth_client_id: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _phase_id: string
          _priority: string
          _request_id: string
          _sort_order: number
          _start_date: string
          _status: string
          _task_type: string
        }
        Returns: Json
      }
      mcp_v1_plan_phase: {
        Args: {
          _confirm_parent_extension: boolean
          _correlation_id: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _new_end: string
          _new_start: string
          _payload_hash: string
          _phase_id: string
          _request_id: string
        }
        Returns: Json
      }
      mcp_v1_plan_task: {
        Args: {
          _confirm_parent_extension: boolean
          _correlation_id: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _new_due: string
          _new_start: string
          _payload_hash: string
          _request_id: string
          _task_id: string
        }
        Returns: Json
      }
      mcp_v1_reorder_phases: {
        Args: {
          _correlation_id: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _payload_hash: string
          _project_id: string
          _request_id: string
          _rows: Json
        }
        Returns: Json
      }
      mcp_v1_reorder_tasks: {
        Args: {
          _correlation_id: string
          _expected_oauth_client_id: string
          _idempotency_key: string
          _payload_hash: string
          _phase_id: string
          _request_id: string
          _rows: Json
        }
        Returns: Json
      }
      mcp_v1_transition_project: {
        Args: {
          _confirm_warnings: boolean
          _correlation_id: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _payload_hash: string
          _project_id: string
          _request_id: string
          _target_status: string
        }
        Returns: Json
      }
      mcp_v1_transition_task: {
        Args: {
          _actual_end_date: string
          _actual_start_date: string
          _correlation_id: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _payload_hash: string
          _request_id: string
          _set_actual_end: boolean
          _set_actual_start: boolean
          _status: string
          _task_id: string
        }
        Returns: Json
      }
      mcp_v1_update_blocker: {
        Args: {
          _blocker_id: string
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _payload_hash: string
          _request_id: string
          _severity: string
          _status: string
          _title: string
        }
        Returns: Json
      }
      mcp_v1_update_kpi: {
        Args: {
          _action_plan_required: boolean
          _auto_snapshot_enabled: boolean
          _cadence: string
          _calculation_key: string
          _comment_required: boolean
          _completion_method: string
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _formula_version: number
          _idempotency_key: string
          _kpi_definition_id: string
          _name: string
          _payload_hash: string
          _request_id: string
          _set_action_plan_required: boolean
          _set_auto_snapshot_enabled: boolean
          _set_cadence: boolean
          _set_calculation_key: boolean
          _set_comment_required: boolean
          _set_completion_method: boolean
          _set_description: boolean
          _set_formula_version: boolean
          _set_name: boolean
          _set_source_mode: boolean
          _set_target_direction: boolean
          _set_target_value: boolean
          _set_unit: boolean
          _set_value_type: boolean
          _source_mode: string
          _target_direction: string
          _target_value: number
          _unit: string
          _value_type: string
        }
        Returns: Json
      }
      mcp_v1_update_phase: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _phase_id: string
          _phase_type: string
          _request_id: string
          _status: string
        }
        Returns: Json
      }
      mcp_v1_update_portfolio: {
        Args: {
          _code: string
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _lifecycle_state: string
          _name: string
          _owner_id: string
          _payload_hash: string
          _portfolio_item_id: string
          _request_id: string
          _set_code: boolean
          _set_description: boolean
          _set_lifecycle_state: boolean
          _set_name: boolean
          _set_owner_id: boolean
          _set_strategic_priority: boolean
          _strategic_priority: string
        }
        Returns: Json
      }
      mcp_v1_update_program: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _program_id: string
          _request_id: string
          _set_description: boolean
          _status: string
        }
        Returns: Json
      }
      mcp_v1_update_project: {
        Args: {
          _assumptions: string
          _budget_narrative: string
          _business_case: string
          _charter: string
          _completion_criteria: string
          _constraints: string
          _correlation_id: string
          _delivery_model: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _goals: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _priority: string
          _program_id: string
          _project_id: string
          _request_id: string
          _scope_in: string
          _scope_out: string
          _set_assumptions: boolean
          _set_budget_narrative: boolean
          _set_business_case: boolean
          _set_charter: boolean
          _set_completion_criteria: boolean
          _set_constraints: boolean
          _set_delivery_model: boolean
          _set_description: boolean
          _set_goals: boolean
          _set_name: boolean
          _set_priority: boolean
          _set_program_id: boolean
          _set_scope_in: boolean
          _set_scope_out: boolean
          _set_success_criteria: boolean
          _success_criteria: string
        }
        Returns: Json
      }
      mcp_v1_update_risk: {
        Args: {
          _correlation_id: string
          _description: string
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _impact: string
          _likelihood: string
          _mitigation_plan: string
          _payload_hash: string
          _request_id: string
          _risk_id: string
          _status: string
          _title: string
        }
        Returns: Json
      }
      mcp_v1_update_task: {
        Args: {
          _correlation_id: string
          _description: string
          _estimated_hours: number
          _expected_oauth_client_id: string
          _expected_updated_at: string
          _idempotency_key: string
          _name: string
          _payload_hash: string
          _priority: string
          _request_id: string
          _status: string
          _task_id: string
          _task_type: string
        }
        Returns: Json
      }
      move_task_workflow_state: {
        Args: { _task_id: string; _workflow_state_id: string }
        Returns: undefined
      }
      org_admin_assign_org_admin: {
        Args: {
          _organization_id: string
          _reason?: string
          _target_user_id: string
        }
        Returns: string
      }
      org_admin_list_org_admin_candidates: {
        Args: { _organization_id: string; _query?: string }
        Returns: {
          display_name: string
          email: string
          user_id: string
        }[]
      }
      org_admin_list_org_admins: {
        Args: { _organization_id: string }
        Returns: {
          can_remove: boolean
          created_at: string
          display_name: string
          email: string
          membership_id: string
          role: string
          status: string
          user_id: string
        }[]
      }
      org_admin_list_org_authority_audit: {
        Args: { _limit?: number; _organization_id: string }
        Returns: {
          action: string
          actor_user_id: string
          created_at: string
          id: string
          metadata: Json
          new_role: string | null
          new_status: string | null
          organization_id: string | null
          previous_role: string | null
          previous_status: string | null
          reason: string | null
          target_email: string | null
          target_user_id: string | null
          tenant_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "admin_authority_audit"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      org_admin_remove_org_admin: {
        Args: {
          _organization_id: string
          _reason?: string
          _target_user_id: string
        }
        Returns: string
      }
      pa_can_admin_workspace: {
        Args: { _workspace_id: string }
        Returns: boolean
      }
      pa_grant_all_workspace_projects: {
        Args: {
          _override_role?: Database["public"]["Enums"]["project_role"]
          _target_user_id: string
          _workspace_id: string
        }
        Returns: number
      }
      pa_grant_project_access: {
        Args: {
          _project_id: string
          _role: Database["public"]["Enums"]["project_role"]
          _target_user_id: string
        }
        Returns: string
      }
      pa_list_user_workspace_projects: {
        Args: { _target_user_id: string; _workspace_id: string }
        Returns: {
          granted_at: string
          is_archived: boolean
          membership_id: string
          project_id: string
          project_name: string
          role: Database["public"]["Enums"]["project_role"]
        }[]
      }
      pa_map_workspace_role_to_project_role: {
        Args: { _ws_role: string }
        Returns: Database["public"]["Enums"]["project_role"]
      }
      pa_remove_project_access: {
        Args: { _project_id: string; _target_user_id: string }
        Returns: undefined
      }
      pa_reset_workspace_to_inherited: {
        Args: { _target_user_id: string; _workspace_id: string }
        Returns: number
      }
      pa_workspace_project_access_counts: {
        Args: { _workspace_id: string }
        Returns: {
          accessible_count: number
          total_active_projects: number
          user_id: string
        }[]
      }
      platform_admin_assign_tenant_admin: {
        Args: { _reason?: string; _target_user_id: string; _tenant_id: string }
        Returns: string
      }
      platform_admin_get_encryption_posture_overview: {
        Args: never
        Returns: Json
      }
      platform_admin_get_overview: { Args: { _reason?: string }; Returns: Json }
      platform_admin_list_tenant_admin_candidates: {
        Args: { _query?: string; _tenant_id: string }
        Returns: {
          display_name: string
          email: string
          user_id: string
        }[]
      }
      platform_admin_list_tenant_admins: {
        Args: { _tenant_id: string }
        Returns: {
          can_remove: boolean
          created_at: string
          display_name: string
          email: string
          is_protected: boolean
          membership_id: string
          role: string
          status: string
          user_id: string
        }[]
      }
      platform_admin_list_tenant_authority_audit: {
        Args: { _limit?: number; _tenant_id: string }
        Returns: {
          action: string
          actor_user_id: string
          created_at: string
          id: string
          metadata: Json
          new_role: string | null
          new_status: string | null
          organization_id: string | null
          previous_role: string | null
          previous_status: string | null
          reason: string | null
          target_email: string | null
          target_user_id: string | null
          tenant_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "admin_authority_audit"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      platform_admin_list_tenants: {
        Args: { _reason?: string }
        Returns: {
          active_member_count: number
          admin_count: number
          created_at: string
          default_organization_id: string
          default_organization_name: string
          name: string
          organization_count: number
          slug: string
          status: string
          tenant_id: string
        }[]
      }
      platform_admin_remove_tenant_admin: {
        Args: { _reason?: string; _target_user_id: string; _tenant_id: string }
        Returns: string
      }
      pmg_build_result: {
        Args: {
          _changes?: Json
          _command: string
          _confirmations?: Json
          _conflict?: Json
          _data?: Json
          _project_id?: string
          _status: Database["public"]["Enums"]["pmg_command_status"]
          _target_id?: string
          _target_type?: string
          _warnings?: Json
        }
        Returns: Json
      }
      pmg_record_command_audit: {
        Args: {
          _command: string
          _correlation_id: string
          _idempotency_key: string
          _integration_id: string
          _metadata: Json
          _project_id: string
          _source_channel: Database["public"]["Enums"]["pmg_source_channel"]
          _status: Database["public"]["Enums"]["pmg_command_status"]
          _target_id: string
          _target_type: string
        }
        Returns: string
      }
      prepare_kpi_app_report_now_select: {
        Args: {
          _mapping_id: string
          _reporting_period_end: string
          _reporting_period_start: string
        }
        Returns: Json
      }
      prepare_kpi_app_report_now_select_system: {
        Args: {
          _mapping_id: string
          _reporting_period_end: string
          _reporting_period_start: string
        }
        Returns: Json
      }
      preview_adoption_template: {
        Args: {
          _template_id?: string
          _template_key?: string
          _workspace_id: string
        }
        Returns: Json
      }
      preview_phase_clone_blueprint: {
        Args: { _phase_id: string }
        Returns: Json
      }
      preview_phase_clone_in_project: {
        Args: { _phase_id: string; _phase_start_date?: string }
        Returns: Json
      }
      preview_phase_planning_change: {
        Args: { _new_end: string; _new_start: string; _phase_id: string }
        Returns: Json
      }
      preview_phase_timeline_action: {
        Args: {
          _action: string
          _new_end: string
          _new_start: string
          _phase_id: string
        }
        Returns: Json
      }
      preview_project_adoption_template: {
        Args: { _project_id: string }
        Returns: Json
      }
      preview_project_clone_blueprint: {
        Args: { _project_id: string }
        Returns: Json
      }
      preview_project_people_preset_application: {
        Args: { _preset_id: string; _project_id: string }
        Returns: Json
      }
      preview_project_planning_change: {
        Args: { _new_end: string; _new_start: string; _project_id: string }
        Returns: Json
      }
      preview_project_template_instantiation: {
        Args: {
          _program_id?: string
          _project_start_date?: string
          _template_id: string
        }
        Returns: Json
      }
      preview_task_clone_blueprint: {
        Args: { _task_id: string }
        Returns: Json
      }
      preview_task_clone_in_phase: {
        Args: { _task_id: string; _task_start_date?: string }
        Returns: Json
      }
      preview_task_planning_change: {
        Args: {
          _new_due: string
          _new_phase_id: string
          _new_start: string
          _task_id: string
        }
        Returns: Json
      }
      publish_roadmap_story_presentation_version: {
        Args: {
          _presentation_blueprint_run_id: string
          _publish_warnings: Json
          _snapshot_json: string
          _source_limitations_json: string
          _source_mode: string
          _story_pack_id: string
          _story_pack_version_id: string
          _title: string
        }
        Returns: Json
      }
      reactivate_workspace: {
        Args: { _workspace_id: string }
        Returns: undefined
      }
      rebaseline_project: { Args: { _project_id: string }; Returns: undefined }
      record_generated_decision_case_document: {
        Args: {
          _document_type: Database["public"]["Enums"]["generated_doc_type"]
          _error_note?: string
          _generation_status: Database["public"]["Enums"]["generated_doc_status"]
          _output_filename: string
          _publish_status?: Database["public"]["Enums"]["generated_doc_publish_status"]
          _record_id: string
          _sharepoint_item_id?: string
          _sharepoint_web_url?: string
          _source_snapshot_at: string
        }
        Returns: string
      }
      record_generated_operational_document:
        | {
            Args: {
              _document_type: Database["public"]["Enums"]["generated_doc_type"]
              _error_note?: string
              _generation_status: Database["public"]["Enums"]["generated_doc_status"]
              _output_filename: string
              _project_id: string
              _source_snapshot_at: string
            }
            Returns: string
          }
        | {
            Args: {
              _document_type: Database["public"]["Enums"]["generated_doc_type"]
              _error_note?: string
              _generation_status: Database["public"]["Enums"]["generated_doc_status"]
              _output_filename: string
              _project_id: string
              _publish_status: Database["public"]["Enums"]["generated_doc_publish_status"]
              _sharepoint_item_id: string
              _sharepoint_web_url: string
              _source_snapshot_at: string
            }
            Returns: string
          }
      record_generated_roadmap_document: {
        Args: {
          _document_type: Database["public"]["Enums"]["generated_doc_type"]
          _error_note?: string
          _generation_status: Database["public"]["Enums"]["generated_doc_status"]
          _output_filename: string
          _project_ids: string[]
          _publish_status: Database["public"]["Enums"]["generated_doc_publish_status"]
          _sharepoint_item_id: string
          _sharepoint_web_url: string
          _source_snapshot_at: string
          _uid: string
          _workspace_id: string
        }
        Returns: string
      }
      record_object_email_snapshot: {
        Args: {
          _organization_id: string
          _payload: string
          _target_id: string
          _target_type: string
          _workspace_id: string
        }
        Returns: string
      }
      record_outbound_email_event: {
        Args: {
          _email_type: string
          _error_code?: string
          _event_key: string
          _metadata?: Json
          _organization_id: string
          _project_id: string
          _provider_message_id?: string
          _recipient_email: string
          _recipient_user_id: string
          _safe_error_message?: string
          _status: string
          _task_id: string
          _tenant_id: string
          _workspace_id: string
        }
        Returns: string
      }
      record_roadmap_story_run_files: {
        Args: { _files: Json; _run_id: string }
        Returns: number
      }
      record_tenant_integration_test_result: {
        Args: {
          _actor_user_id: string
          _function_name: string
          _integration_id: string
          _organization_id: string
          _request_id: string
          _result: string
          _safe_error_code: string
        }
        Returns: undefined
      }
      register_tenant_storage_object: {
        Args: {
          _bucket: string
          _checksum?: string
          _content_type?: string
          _file_name: string
          _legacy_object_path?: string
          _metadata?: Json
          _object_id: string
          _object_type: string
          _organization_id: string
          _size_bytes?: number
          _surface: string
          _tenant_id: string
          _workspace_id: string
        }
        Returns: {
          bucket: string
          checksum: string | null
          content_type: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          file_name: string
          id: string
          legacy_object_path: string | null
          metadata: Json
          object_id: string | null
          object_path: string
          object_type: string
          organization_id: string
          size_bytes: number | null
          storage_status: string
          surface: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenant_storage_objects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_dependency: {
        Args: {
          _correlation_id?: string
          _dependency_id: string
          _expected_updated_at: string
          _idempotency_key?: string
        }
        Returns: Json
      }
      remove_project_people_preset_member: {
        Args: {
          _correlation_id?: string
          _expected_preset_updated_at: string
          _idempotency_key?: string
          _member_id: string
        }
        Returns: Json
      }
      remove_project_stakeholder: {
        Args: { _stakeholder_id: string }
        Returns: undefined
      }
      remove_roadmap_story_pack_external_file: {
        Args: { _file_id: string }
        Returns: undefined
      }
      rename_project_people_preset: {
        Args: {
          _correlation_id?: string
          _description: string
          _expected_updated_at: string
          _idempotency_key?: string
          _name: string
          _preset_id: string
        }
        Returns: Json
      }
      reopen_phase: { Args: { _phase_id: string }; Returns: undefined }
      reopen_task: { Args: { _task_id: string }; Returns: undefined }
      reorder_backlog_items: {
        Args: {
          _correlation_id?: string
          _idempotency_key?: string
          _project_id: string
          _rows: Json
        }
        Returns: Json
      }
      reorder_phases: {
        Args: {
          _correlation_id?: string
          _idempotency_key?: string
          _project_id: string
          _rows: Json
        }
        Returns: Json
      }
      reorder_tasks: {
        Args: {
          _correlation_id?: string
          _idempotency_key?: string
          _phase_id: string
          _rows: Json
        }
        Returns: Json
      }
      report_governance_cadences: {
        Args: {
          _include_archived?: boolean
          _organization_id: string
          _project_ids?: string[]
          _workspace_id?: string
        }
        Returns: Json
      }
      report_governance_event_types: {
        Args: {
          _organization_id: string
          _project_ids?: string[]
          _workspace_id?: string
        }
        Returns: Json
      }
      report_governance_records: {
        Args: {
          _include_archived?: boolean
          _organization_id: string
          _project_ids?: string[]
          _workspace_id?: string
        }
        Returns: Json
      }
      report_project_governance_summary: {
        Args: {
          _organization_id: string
          _project_ids?: string[]
          _workspace_id?: string
        }
        Returns: Json
      }
      reset_kpi_app_outbox: {
        Args: { _outbox_id: string; _reason?: string }
        Returns: Json
      }
      resolve_child_project_scope: {
        Args: {
          _project_id_direct: string
          _table: string
          _target_id: string
          _target_type: string
        }
        Returns: string
      }
      resolve_effective_integration_secret_ref: {
        Args: {
          _function_name?: string
          _integration_kind: Database["public"]["Enums"]["tenant_integration_kind"]
          _integration_name?: string
          _organization_id: string
          _reason?: string
          _request_id?: string
          _secret_name: string
          _tenant_id: string
        }
        Returns: Json
      }
      resolve_effective_integration_secret_value: {
        Args: {
          _function_name?: string
          _integration_kind: Database["public"]["Enums"]["tenant_integration_kind"]
          _integration_name?: string
          _organization_id: string
          _reason?: string
          _request_id?: string
          _secret_name: string
          _tenant_id: string
        }
        Returns: Json
      }
      resolve_organization_encryption_key_metadata: {
        Args: { _organization_id: string; _tenant_id: string }
        Returns: Json
      }
      resolve_project_id: {
        Args: { _target_id: string; _target_type: string }
        Returns: string
      }
      resolve_project_id_from_governance_cadence: {
        Args: { _cadence_id: string }
        Returns: string
      }
      resolve_project_id_from_governance_record: {
        Args: { _record_id: string }
        Returns: string
      }
      resolve_project_id_from_sharepoint_project_binding: {
        Args: { _binding_id: string }
        Returns: string
      }
      resolve_route_context_boundary: {
        Args: {
          _phase_id?: string
          _program_id?: string
          _project_id?: string
          _task_id?: string
          _workspace_id?: string
        }
        Returns: Json
      }
      resolve_sharepoint_project_binding: {
        Args: { _project_id: string }
        Returns: {
          binding_mode: Database["public"]["Enums"]["sharepoint_project_binding_mode"]
          binding_status: Database["public"]["Enums"]["sharepoint_project_binding_status"]
          effective_library_id_or_drive_id: string
          effective_library_web_url: string
          effective_site_id: string
          effective_site_web_url: string
          folder_item_id: string
          folder_relative_path: string
          folder_web_url: string
          is_restricted: boolean
          last_validated_at: string
          last_validation_code: string
          last_validation_note: string
          organization_id: string
          project_binding_id: string
          project_id: string
          workspace_binding_id: string
          workspace_binding_status: Database["public"]["Enums"]["sharepoint_workspace_binding_status"]
          workspace_id: string
        }[]
      }
      resolve_tenant_encryption_key_version_metadata: {
        Args: { _key_version: number; _tenant_id: string }
        Returns: Json
      }
      resolve_tenant_encryption_v1_metadata: {
        Args: { _tenant_id: string }
        Returns: Json
      }
      restore_governance_cadence: {
        Args: { _cadence_id: string }
        Returns: undefined
      }
      restore_governance_record: {
        Args: { _record_id: string }
        Returns: undefined
      }
      restore_governance_record_btpm_context_link: {
        Args: { _context_link_id: string }
        Returns: undefined
      }
      restore_governance_record_cross_project_link: {
        Args: { _cross_project_link_id: string }
        Returns: undefined
      }
      restore_governance_record_evidence_file: {
        Args: { _evidence_file_id: string }
        Returns: undefined
      }
      restore_governance_record_evidence_reference: {
        Args: { _evidence_id: string }
        Returns: undefined
      }
      restore_project_people_preset: {
        Args: {
          _correlation_id?: string
          _expected_updated_at: string
          _idempotency_key?: string
          _preset_id: string
        }
        Returns: Json
      }
      restore_project_stakeholder: {
        Args: { _stakeholder_id: string }
        Returns: undefined
      }
      revoke_api_d_policy: {
        Args: { _client_key: string; _correlation_id?: string }
        Returns: Json
      }
      roadmap_story_allowed_source_categories: {
        Args: never
        Returns: string[]
      }
      save_ai_decision_brief_version: {
        Args: {
          _ai_run_id: string
          _edited_brief_text: string
          _make_current?: boolean
          _record_id: string
        }
        Returns: Json
      }
      save_ai_decision_brief_version_v2: {
        Args: {
          _ai_run_id: string
          _confidence_level?: string
          _decision_readiness?: string
          _edited_brief_text: string
          _guardrails_text?: string
          _make_current?: boolean
          _open_questions_text?: string
          _recommendation_text?: string
          _record_id: string
          _requested_decision_text?: string
          _residual_risks_text?: string
        }
        Returns: Json
      }
      save_decision_brief_version_v3: {
        Args: {
          _ai_run_id?: string
          _confidence_level?: string
          _decision_readiness?: string
          _edited_brief_text?: string
          _executive_intro_text?: string
          _guardrails_text?: string
          _make_current?: boolean
          _open_questions_text?: string
          _options_summary?: string
          _recommendation_text?: string
          _record_id: string
          _requested_decision_text?: string
          _residual_risks_text?: string
          _source_type: string
        }
        Returns: Json
      }
      save_project_people_preset_from_project: {
        Args: {
          _correlation_id?: string
          _description?: string
          _idempotency_key?: string
          _name: string
          _project_id: string
        }
        Returns: Json
      }
      save_project_template_from_project: {
        Args: {
          _project_id: string
          _template_description?: string
          _template_name: string
        }
        Returns: Json
      }
      search_workspace_project_deep_matches: {
        Args: {
          _include_archived?: boolean
          _query: string
          _workspace_id: string
        }
        Returns: Json
      }
      search_workspace_reference_targets: {
        Args: { _query?: string; _workspace_id: string }
        Returns: Json
      }
      service_enqueue_tenant_background_job: {
        Args: {
          _idempotency_key?: string
          _job_type: string
          _max_attempts?: number
          _not_before?: string
          _organization_id?: string
          _payload?: Json
          _priority?: number
          _requested_by?: string
          _run_as_user_id?: string
          _tenant_id: string
          _workspace_id?: string
        }
        Returns: {
          attempt_count: number
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          failed_at: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          last_error: string | null
          max_attempts: number
          not_before: string | null
          organization_id: string | null
          payload: Json
          priority: number
          requested_by: string | null
          result: Json | null
          run_as_user_id: string | null
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenant_background_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      service_get_tenant_protected_download_context: {
        Args: { _requested_by?: string; _storage_object_id: string }
        Returns: Json
      }
      service_manage_powerbi_reporting_identity: {
        Args: { _action: string; _actor_user_id: string; _tenant_id: string }
        Returns: Json
      }
      service_register_tenant_storage_object: {
        Args: {
          _bucket: string
          _checksum?: string
          _content_type?: string
          _created_by?: string
          _file_name: string
          _legacy_object_path?: string
          _metadata?: Json
          _object_id?: string
          _object_type: string
          _organization_id: string
          _size_bytes?: number
          _surface: string
          _tenant_id: string
          _workspace_id?: string
        }
        Returns: {
          bucket: string
          checksum: string | null
          content_type: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          file_name: string
          id: string
          legacy_object_path: string | null
          metadata: Json
          object_id: string | null
          object_path: string
          object_type: string
          organization_id: string
          size_bytes: number | null
          storage_status: string
          surface: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenant_storage_objects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_current_governance_record_brief_version: {
        Args: { _brief_version_id: string }
        Returns: undefined
      }
      set_current_governance_record_copilot_data_package: {
        Args: { _package_id: string }
        Returns: undefined
      }
      set_current_governance_record_stakeholder_package: {
        Args: { _package_id: string }
        Returns: undefined
      }
      set_governance_record_decisions: {
        Args: { _decisions: Json; _record_id: string }
        Returns: undefined
      }
      set_governance_record_links: {
        Args: { _links: Json; _record_id: string }
        Returns: undefined
      }
      set_my_active_context: {
        Args: {
          _is_all_workspaces?: boolean
          _organization_id: string
          _tenant_id: string
          _workspace_id?: string
        }
        Returns: Json
      }
      set_powerbi_workspace_scope: {
        Args: {
          _organization_id: string
          _reason?: string
          _scope_mode: string
          _workspace_id: string
        }
        Returns: string
      }
      set_project_template_archived: {
        Args: { _is_archived: boolean; _template_id: string }
        Returns: Json
      }
      set_roadmap_story_pack_sources: {
        Args: { _sources: Json; _story_pack_id: string }
        Returns: undefined
      }
      set_roadmap_story_presentation_run_response_id: {
        Args: { _openai_response_id: string; _run_id: string }
        Returns: undefined
      }
      set_roadmap_story_run_response_id: {
        Args: {
          _files_selected_count?: number
          _files_sent_count?: number
          _files_skipped_count?: number
          _openai_response_id: string
          _run_id: string
          _total_bytes_sent?: number
        }
        Returns: undefined
      }
      set_task_assignee: {
        Args: { _assignee_id: string; _task_id: string }
        Returns: Json
      }
      start_roadmap_story_generation_run: {
        Args: {
          _input_manifest: Json
          _model: string
          _prompt_summary: string
          _provider: string
          _reasoning_effort: string
          _story_pack_id: string
        }
        Returns: string
      }
      start_roadmap_story_presentation_run: {
        Args: {
          _input_manifest: Json
          _input_package_json: string
          _model: string
          _prompt: string
          _provider: string
          _reasoning_effort: string
          _story_pack_id: string
          _story_pack_version_id: string
        }
        Returns: string
      }
      start_tenant_scheduler_run: {
        Args: { _metadata?: Json; _scheduler_name: string; _tenant_id: string }
        Returns: {
          completed_at: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          jobs_enqueued: number
          metadata: Json
          scheduler_name: string
          started_at: string
          status: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_scheduler_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sync_sharepoint_org_site_projection: {
        Args: {
          _organization_id: string
          _site_id: string
          _site_label_or_name: string
          _site_web_url: string
          _validation_code: string
          _validation_note: string
          _validation_status: string
        }
        Returns: {
          connection_status: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          id: string
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          managed_outside_btpm: boolean
          organization_id: string
          site_id: string | null
          site_label_or_name: string | null
          site_web_url: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sharepoint_org_site_connections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tenant_admin_assign_org_admin: {
        Args: {
          _organization_id: string
          _reason?: string
          _target_user_id: string
        }
        Returns: string
      }
      tenant_admin_assign_tenant_admin: {
        Args: { _reason?: string; _target_user_id: string; _tenant_id: string }
        Returns: string
      }
      tenant_admin_disable_integration_secret: {
        Args: {
          _integration_id: string
          _organization_id?: string
          _reason?: string
          _secret_name: string
        }
        Returns: Json
      }
      tenant_admin_get_ai_provider_setting: {
        Args: { _tenant_id: string }
        Returns: Json
      }
      tenant_admin_get_azure_openai_deployments: {
        Args: { _integration_id: string }
        Returns: Json
      }
      tenant_admin_get_azure_openai_endpoint: {
        Args: { _integration_id: string }
        Returns: Json
      }
      tenant_admin_get_encryption_posture: {
        Args: { _tenant_id: string }
        Returns: Json
      }
      tenant_admin_get_integration_detail: {
        Args: { _integration_id: string }
        Returns: Json
      }
      tenant_admin_get_operations_summary: {
        Args: { _tenant_id: string }
        Returns: Json
      }
      tenant_admin_get_organization_detail: {
        Args: { _organization_id: string }
        Returns: Json
      }
      tenant_admin_get_organization_encryption_posture: {
        Args: { _organization_id: string }
        Returns: Json
      }
      tenant_admin_get_overview: { Args: { _tenant_id: string }; Returns: Json }
      tenant_admin_get_powerbi_reporting_readiness: {
        Args: { _tenant_id: string }
        Returns: Json
      }
      tenant_admin_list_integration_secret_metadata: {
        Args: { _integration_id: string; _organization_id?: string }
        Returns: {
          created_at: string
          disabled_at: string
          integration_id: string
          organization_id: string
          organization_name: string
          revoked_at: string
          rotated_at: string
          secret_kind: string
          secret_name: string
          secret_scope: string
          status: string
          updated_at: string
        }[]
      }
      tenant_admin_list_members: {
        Args: { _tenant_id: string }
        Returns: {
          created_at: string
          deactivated_at: string
          display_name: string
          email: string
          membership_id: string
          role: string
          status: string
          user_id: string
        }[]
      }
      tenant_admin_list_org_admin_candidates: {
        Args: { _organization_id: string; _query?: string }
        Returns: {
          display_name: string
          email: string
          is_org_member: boolean
          user_id: string
        }[]
      }
      tenant_admin_list_org_admins: {
        Args: { _organization_id: string }
        Returns: {
          can_remove: boolean
          created_at: string
          display_name: string
          email: string
          membership_id: string
          role: string
          status: string
          user_id: string
        }[]
      }
      tenant_admin_list_org_authority_audit: {
        Args: { _limit?: number; _organization_id: string }
        Returns: {
          action: string
          actor_user_id: string
          created_at: string
          id: string
          metadata: Json
          new_role: string | null
          new_status: string | null
          organization_id: string | null
          previous_role: string | null
          previous_status: string | null
          reason: string | null
          target_email: string | null
          target_user_id: string | null
          tenant_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "admin_authority_audit"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tenant_admin_list_organizations: {
        Args: { _tenant_id: string }
        Returns: {
          active_member_count: number
          created_at: string
          environment_role: string
          is_default: boolean
          name: string
          organization_id: string
          organization_kind: string
          slug: string
        }[]
      }
      tenant_admin_list_tenant_admin_candidates: {
        Args: { _query?: string; _tenant_id: string }
        Returns: {
          display_name: string
          email: string
          user_id: string
        }[]
      }
      tenant_admin_list_tenant_admins: {
        Args: { _tenant_id: string }
        Returns: {
          can_remove: boolean
          created_at: string
          display_name: string
          email: string
          is_protected: boolean
          membership_id: string
          role: string
          status: string
          user_id: string
        }[]
      }
      tenant_admin_list_tenant_authority_audit: {
        Args: { _limit?: number; _tenant_id: string }
        Returns: {
          action: string
          actor_user_id: string
          created_at: string
          id: string
          metadata: Json
          new_role: string | null
          new_status: string | null
          organization_id: string | null
          previous_role: string | null
          previous_status: string | null
          reason: string | null
          target_email: string | null
          target_user_id: string | null
          tenant_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "admin_authority_audit"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tenant_admin_remove_org_admin: {
        Args: {
          _organization_id: string
          _reason?: string
          _target_user_id: string
        }
        Returns: string
      }
      tenant_admin_remove_tenant_admin: {
        Args: { _reason?: string; _target_user_id: string; _tenant_id: string }
        Returns: string
      }
      tenant_admin_set_ai_provider: {
        Args: { _provider: string; _reason?: string; _tenant_id: string }
        Returns: Json
      }
      tenant_admin_set_integration_enabled: {
        Args: {
          _integration_id: string
          _is_enabled: boolean
          _reason?: string
        }
        Returns: {
          active_secret_count: number
          integration_id: string
          is_enabled: boolean
          status: Database["public"]["Enums"]["tenant_integration_status"]
        }[]
      }
      tenant_admin_store_integration_secret: {
        Args: {
          _integration_id: string
          _organization_id?: string
          _reason?: string
          _secret_kind?: string
          _secret_name: string
          _secret_value: string
        }
        Returns: Json
      }
      tenant_admin_update_azure_openai_deployments: {
        Args: { _deployments: Json; _integration_id: string; _reason?: string }
        Returns: Json
      }
      tenant_admin_update_azure_openai_endpoint: {
        Args: { _endpoint: string; _integration_id: string; _reason?: string }
        Returns: Json
      }
      toggle_project_agile_mode: {
        Args: { _enable?: boolean; _project_id: string }
        Returns: undefined
      }
      transition_governance_decision_case_stage: {
        Args: { _record_id: string; _target_stage: string }
        Returns: undefined
      }
      transition_project_stage: {
        Args: {
          _project_id: string
          _project_stage: Database["public"]["Enums"]["project_stage"]
        }
        Returns: {
          actual_end_date: string | null
          actual_start_date: string | null
          agile_enabled: boolean
          assumptions: string | null
          baseline_approved_at: string | null
          baseline_approved_by: string | null
          baseline_end_date: string | null
          baseline_start_date: string | null
          budget_narrative: string | null
          business_case: string | null
          charter: string | null
          completion_criteria: string | null
          constraints: string | null
          created_at: string
          created_by: string | null
          delivery_model:
            | Database["public"]["Enums"]["project_delivery_model"]
            | null
          description: string | null
          goals: string | null
          id: string
          is_archived: boolean
          is_baselined: boolean
          name: string
          organization_id: string
          portfolio_item_id: string | null
          priority: Database["public"]["Enums"]["pm_priority"]
          program_id: string | null
          project_stage: Database["public"]["Enums"]["project_stage"]
          scope_in: string | null
          scope_out: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["pm_status"]
          success_criteria: string | null
          target_end_date: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unarchive_backlog_item: { Args: { _id: string }; Returns: undefined }
      unarchive_board_workflow_state: {
        Args: { _id: string }
        Returns: undefined
      }
      unarchive_kpi_definition: { Args: { _id: string }; Returns: undefined }
      unarchive_phase: { Args: { _id: string }; Returns: undefined }
      unarchive_program: { Args: { _id: string }; Returns: undefined }
      unarchive_project: { Args: { _id: string }; Returns: undefined }
      unarchive_project_template: { Args: { _id: string }; Returns: undefined }
      unarchive_roadmap_story_pack: {
        Args: { _story_pack_id: string }
        Returns: undefined
      }
      unarchive_sprint: { Args: { _id: string }; Returns: undefined }
      unarchive_task: { Args: { _id: string }; Returns: undefined }
      unlink_adoption_object: { Args: { _link_id: string }; Returns: boolean }
      unlink_task_from_adoption: { Args: { _task_id: string }; Returns: string }
      update_adoption_initiative: {
        Args: {
          _initiative_id: string
          _name?: string
          _owner_id?: string
          _priority?: Database["public"]["Enums"]["pm_priority"]
          _set_name?: boolean
          _set_owner?: boolean
          _set_summary?: boolean
          _set_target_date?: boolean
          _sort_order?: number
          _status?: Database["public"]["Enums"]["adoption_initiative_status"]
          _summary?: string
          _target_date?: string
        }
        Returns: string
      }
      update_adoption_template_from_payload: {
        Args: {
          _description: string
          _name: string
          _payload: Json
          _template_id: string
        }
        Returns: string
      }
      update_ai_feature_setting: {
        Args: {
          _enabled: boolean
          _feature_key: string
          _max_files_per_request: number
          _max_individual_file_mb: number
          _max_total_file_mb: number
          _model_registry_id: string
          _reasoning_effort: string
          _require_user_confirmation: boolean
        }
        Returns: {
          created_at: string
          enabled: boolean
          feature_key: string
          id: string
          max_files_per_request: number | null
          max_individual_file_mb: number | null
          max_total_file_mb: number | null
          model_registry_id: string
          organization_id: string
          provider: string
          reasoning_effort: string | null
          require_user_confirmation: boolean
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ai_feature_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_blocker_with_links: {
        Args: {
          _blocker_id: string
          _description: string
          _object_links?: Json
          _severity: string
          _status: string
          _title: string
          _user_links?: Json
        }
        Returns: Json
      }
      update_comment_with_references: {
        Args: { _body: string; _comment_id: string; _references?: Json }
        Returns: Json
      }
      update_governance_cadence:
        | {
            Args: {
              _cadence_id: string
              _clear_event_name?: boolean
              _clear_expected_evidence_type?: boolean
              _clear_next_expected_date?: boolean
              _clear_owner?: boolean
              _event_name?: string
              _event_type?: string
              _expected_evidence_type?: string
              _frequency_type?: string
              _next_expected_date?: string
              _owner_id?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              _cadence_id: string
              _clear_event_name?: boolean
              _clear_expected_evidence_type?: boolean
              _clear_next_expected_date?: boolean
              _clear_owner?: boolean
              _clear_owner_stakeholder?: boolean
              _event_name?: string
              _event_type?: string
              _expected_evidence_type?: string
              _frequency_type?: string
              _next_expected_date?: string
              _owner_id?: string
              _owner_stakeholder_id?: string
            }
            Returns: undefined
          }
      update_governance_record: {
        Args: {
          _actual_date_held?: string
          _cadence_id?: string
          _clear_cadence?: boolean
          _clear_decision_owner_stakeholder_id?: boolean
          _clear_decision_question?: boolean
          _clear_decisions_summary?: boolean
          _clear_event_name?: boolean
          _clear_expected_date_snapshot?: boolean
          _clear_external_reference_url?: boolean
          _clear_sharepoint_evidence_reference?: boolean
          _clear_summary?: boolean
          _clear_target_decision_date?: boolean
          _decision_owner_stakeholder_id?: string
          _decision_question?: string
          _decision_stage?: string
          _decisions_summary?: string
          _event_name?: string
          _event_type?: string
          _expected_date_snapshot?: string
          _external_reference_url?: string
          _record_id: string
          _sharepoint_evidence_reference?: string
          _summary?: string
          _target_decision_date?: string
        }
        Returns: undefined
      }
      update_governance_record_btpm_context_link: {
        Args: {
          _clear_context_reason?: boolean
          _context_link_id: string
          _context_reason?: string
          _included_in_package?: boolean
          _object_id?: string
          _object_type?: string
          _relationship_type?: string
          _relevance_level?: string
          _source_project_id?: string
        }
        Returns: undefined
      }
      update_governance_record_cross_project_link: {
        Args: {
          _clear_relationship_reason?: boolean
          _clear_source_dependency_id?: boolean
          _cross_project_link_id: string
          _included_in_package?: boolean
          _linked_project_id?: string
          _relationship_reason?: string
          _relationship_type?: string
          _source_dependency_id?: string
        }
        Returns: undefined
      }
      update_governance_record_evidence_file: {
        Args: {
          _clear_evidence_summary?: boolean
          _evidence_date?: string
          _evidence_file_id: string
          _evidence_summary?: string
          _evidence_title?: string
          _included_in_package?: boolean
          _relevance_level?: string
        }
        Returns: undefined
      }
      update_governance_record_evidence_reference: {
        Args: {
          _clear_evidence_date?: boolean
          _clear_owner_stakeholder_id?: boolean
          _clear_summary?: boolean
          _evidence_date?: string
          _evidence_id: string
          _evidence_type?: string
          _external_url?: string
          _included_in_package?: boolean
          _owner_stakeholder_id?: string
          _relevance_level?: string
          _summary?: string
          _title?: string
        }
        Returns: undefined
      }
      update_project_adoption_plan: {
        Args: {
          _adoption_owner_id?: string
          _adoption_plan_id: string
          _approach_summary?: string
          _enabled?: boolean
          _impacted_audience_summary?: string
          _objective?: string
          _readiness_status?: Database["public"]["Enums"]["adoption_readiness_status"]
          _set_approach?: boolean
          _set_audience?: boolean
          _set_objective?: boolean
          _set_owner?: boolean
        }
        Returns: string
      }
      update_project_benefit: {
        Args: {
          _actual_realization_date?: string
          _actual_value?: number
          _baseline_value?: number
          _benefit_id: string
          _benefit_owner_id?: string
          _benefit_type?: string
          _clear_actual_realization_date?: boolean
          _clear_actual_value?: boolean
          _clear_baseline_value?: boolean
          _clear_benefit_owner_id?: boolean
          _clear_custom_benefit_type_label?: boolean
          _clear_description?: boolean
          _clear_evidence_note?: boolean
          _clear_expected_realization_date?: boolean
          _custom_benefit_type_label?: string
          _description?: string
          _evidence_note?: string
          _expected_realization_date?: string
          _metric_name?: string
          _realization_status?: string
          _target_value?: number
          _unit_of_measure?: string
        }
        Returns: undefined
      }
      update_project_people_preset_member: {
        Args: {
          _canonical_role_key: string
          _correlation_id?: string
          _expected_preset_updated_at: string
          _external_name: string
          _idempotency_key?: string
          _member_id: string
          _role_label: string
        }
        Returns: Json
      }
      update_project_stakeholder: {
        Args: {
          _external_name: string
          _notes: string
          _role_label: string
          _stakeholder_id: string
          _start_date?: string
        }
        Returns: undefined
      }
      update_project_template_metadata: {
        Args: { _description?: string; _name: string; _template_id: string }
        Returns: Json
      }
      update_risk_with_links: {
        Args: {
          _description: string
          _impact: string
          _likelihood: string
          _mitigation_plan: string
          _object_links?: Json
          _risk_id: string
          _status: string
          _title: string
          _user_links?: Json
        }
        Returns: Json
      }
      update_roadmap_story_pack_config: {
        Args: {
          _audience?: string
          _focus?: string
          _guidance?: string
          _patch_audience?: boolean
          _patch_focus?: boolean
          _patch_guidance?: boolean
          _patch_primary_workspace?: boolean
          _patch_program?: boolean
          _patch_title?: boolean
          _primary_workspace_id?: string
          _program_id?: string
          _scope_config?: Json
          _source_config?: Json
          _story_pack_id: string
          _title?: string
        }
        Returns: undefined
      }
      update_roadmap_story_pack_external_file: {
        Args: {
          _display_name?: string
          _file_id: string
          _include_in_story?: boolean
          _mime_type?: string
          _patch_display_name?: boolean
          _patch_include_in_story?: boolean
          _patch_mime_type?: boolean
          _patch_size_bytes?: boolean
          _patch_user_note?: boolean
          _patch_web_url?: boolean
          _size_bytes?: number
          _user_note?: string
          _web_url?: string
        }
        Returns: undefined
      }
      update_roadmap_story_pack_note: {
        Args: {
          _body?: string
          _include_in_story?: boolean
          _label?: string
          _note_id: string
          _patch_body?: boolean
          _patch_include?: boolean
          _patch_label?: boolean
          _patch_sort?: boolean
          _sort_order?: number
        }
        Returns: undefined
      }
      update_roadmap_story_pack_visual_settings: {
        Args: { _settings: Json; _story_pack_id: string }
        Returns: Json
      }
      upsert_governance_record_decision_outcome: {
        Args: {
          _approval_forum?: string
          _conditions_guardrails?: string
          _decided_by_text?: string
          _decision_date: string
          _decision_rationale?: string
          _decision_result: string
          _final_decision_text: string
          _follow_up_actions?: string
          _implementation_owner_stakeholder_id?: string
          _implementation_target_date?: string
          _record_id: string
          _residual_risks?: string
          _signoff_evidence_url?: string
          _signoff_status?: string
        }
        Returns: string
      }
      upsert_project_closure_summary: {
        Args: {
          _achievements_summary?: string
          _benefits_summary?: string
          _open_items_summary?: string
          _outcome_summary?: string
          _project_id: string
          _transition_notes?: string
        }
        Returns: string
      }
      upsert_project_lessons_learned_document_metadata: {
        Args: {
          _created_in_sharepoint_at?: string
          _document_name?: string
          _event_type?: string
          _last_modified_at?: string
          _project_id: string
          _sharepoint_drive_id?: string
          _sharepoint_item_id?: string
          _sharepoint_web_url?: string
          _status: string
        }
        Returns: string
      }
      upsert_sharepoint_org_site: {
        Args: {
          _managed_outside_btpm?: boolean
          _organization_id: string
          _site_id?: string
          _site_label_or_name?: string
          _site_web_url: string
        }
        Returns: {
          connection_status: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          id: string
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          managed_outside_btpm: boolean
          organization_id: string
          site_id: string | null
          site_label_or_name: string | null
          site_web_url: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sharepoint_org_site_connections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_sharepoint_project_binding: {
        Args: {
          _binding_mode: Database["public"]["Enums"]["sharepoint_project_binding_mode"]
          _folder_item_id?: string
          _folder_relative_path?: string
          _folder_web_url: string
          _project_id: string
          _resolved_library_id_or_drive_id?: string
          _resolved_library_web_url?: string
          _resolved_site_id?: string
          _resolved_site_web_url?: string
        }
        Returns: {
          binding_mode: Database["public"]["Enums"]["sharepoint_project_binding_mode"]
          binding_status: Database["public"]["Enums"]["sharepoint_project_binding_status"]
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          folder_item_id: string | null
          folder_relative_path: string | null
          folder_web_url: string
          id: string
          is_restricted: boolean
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          organization_id: string
          project_id: string
          resolved_library_id_or_drive_id: string | null
          resolved_library_web_url: string | null
          resolved_site_id: string | null
          resolved_site_web_url: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
          workspace_sharepoint_binding_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sharepoint_project_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_sharepoint_workspace_binding: {
        Args: {
          _library_id_or_drive_id?: string
          _library_label_or_name?: string
          _library_web_url?: string
          _managed_outside_btpm?: boolean
          _site_id?: string
          _site_label_or_name?: string
          _site_web_url?: string
          _workspace_id: string
        }
        Returns: {
          binding_status: Database["public"]["Enums"]["sharepoint_workspace_binding_status"]
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          id: string
          last_validated_at: string | null
          last_validation_code: string | null
          last_validation_note: string | null
          library_id_or_drive_id: string | null
          library_label_or_name: string | null
          library_web_url: string
          managed_outside_btpm: boolean
          organization_id: string
          site_id: string | null
          site_label_or_name: string | null
          site_web_url: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "sharepoint_workspace_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_user_saved_view: {
        Args: {
          _id: string
          _name: string
          _scope_key: string
          _state: Json
          _surface_key: string
        }
        Returns: Json
      }
      validate_project_completion: {
        Args: { _project_id: string }
        Returns: Json
      }
      validate_roadmap_story_scope: {
        Args: { _org_id: string; _scope: Json; _user_id: string }
        Returns: undefined
      }
      validate_tenant_storage_access: {
        Args: { _action: string; _storage_object_id: string }
        Returns: boolean
      }
      ws_add_member: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _target_user_id: string
          _workspace_id: string
        }
        Returns: undefined
      }
      ws_change_member_role: {
        Args: {
          _new_role: Database["public"]["Enums"]["app_role"]
          _target_user_id: string
          _workspace_id: string
        }
        Returns: undefined
      }
      ws_create_invitation: {
        Args: {
          _email: string
          _role: Database["public"]["Enums"]["app_role"]
          _workspace_id: string
        }
        Returns: string
      }
      ws_list_add_member_candidates: {
        Args: { _workspace_id: string }
        Returns: {
          display_name: string
          email: string
          user_id: string
        }[]
      }
      ws_list_members: {
        Args: { _workspace_id: string }
        Returns: {
          display_name: string
          email: string
          is_active: boolean
          user_id: string
          workspace_role: string
        }[]
      }
      ws_list_pending_invitations: {
        Args: { _workspace_id: string }
        Returns: {
          email: string
          expires_at: string
          id: string
          invited_at: string
          is_expired: boolean
          role: string
        }[]
      }
      ws_remove_member: {
        Args: { _target_user_id: string; _workspace_id: string }
        Returns: undefined
      }
    }
    Enums: {
      adoption_initiative_status:
        | "planned"
        | "active"
        | "at_risk"
        | "completed"
        | "cancelled"
      adoption_readiness_area:
        | "stakeholder_impact"
        | "sponsor_alignment"
        | "communication"
        | "training_enablement"
        | "feedback_collection"
        | "adoption_tracking"
        | "hypercare"
        | "reinforcement_lessons"
      adoption_readiness_status:
        | "not_started"
        | "preparing"
        | "in_progress"
        | "at_risk"
        | "ready"
        | "reinforced"
      app_role:
        | "org_admin"
        | "workspace_admin"
        | "project_manager"
        | "contributor"
        | "viewer"
      blocker_status: "open" | "in_progress" | "resolved"
      dependency_type:
        | "finish_to_start"
        | "start_to_start"
        | "finish_to_finish"
        | "start_to_finish"
      environment_role: "production" | "non_production"
      generated_doc_publish_status:
        | "not_published"
        | "published"
        | "publish_failed"
      generated_doc_status: "generated_local" | "generation_failed"
      generated_doc_type:
        | "project_overview_charter"
        | "weekly_project_status_deck"
        | "roadmap_status_deck"
        | "decision_case_word_brief"
        | "decision_case_ppt_onepager"
        | "project_closure_report"
      knowledge_article_status: "draft" | "published" | "archived"
      knowledge_article_type:
        | "concept"
        | "how_to"
        | "rulebook"
        | "faq"
        | "release_note"
        | "admin"
        | "integration_placeholder"
      knowledge_article_visibility:
        | "all_users"
        | "admin_only"
        | "workspace_scoped"
      kpi_target_direction:
        | "increase"
        | "decrease"
        | "maintain"
        | "target_exact"
      membership_status: "invited" | "active" | "suspended" | "deactivated"
      organization_kind:
        | "production"
        | "qas"
        | "test"
        | "sandbox"
        | "business_unit"
        | "legal_entity"
        | "other"
      organization_role: "org_admin" | "org_member"
      phase_type:
        | "milestone"
        | "deliverable"
        | "work_item"
        | "decision"
        | "review"
      pm_priority: "low" | "medium" | "high" | "critical"
      pm_status: "planned" | "active" | "completed" | "on_hold" | "cancelled"
      pmg_command_status:
        | "ready"
        | "applied"
        | "no_change"
        | "confirmation_required"
        | "conflict"
        | "blocked"
        | "not_authorized"
        | "invalid"
      pmg_source_channel:
        | "btpm_ui"
        | "admin_import"
        | "external_api"
        | "mcp"
        | "background_job"
        | "btpm_internal"
      project_delivery_model:
        | "internal_delivery"
        | "vendor_delivery"
        | "co_delivery"
      project_role: "project_manager" | "contributor" | "viewer"
      project_stage: "initiation" | "planning" | "execution" | "closure"
      raci_role: "responsible" | "accountable" | "consulted" | "informed"
      risk_likelihood: "low" | "medium" | "high"
      risk_status:
        | "identified"
        | "mitigating"
        | "accepted"
        | "closed"
        | "open"
        | "under_mitigation"
        | "monitoring"
        | "realized"
      sharepoint_project_binding_mode:
        | "workspace_library_default"
        | "restricted_library_override"
        | "restricted_site_override"
      sharepoint_project_binding_status:
        | "linked_unvalidated"
        | "validated"
        | "invalid"
        | "disabled"
      sharepoint_workspace_binding_status:
        | "configured_unvalidated"
        | "validated"
        | "invalid"
        | "disabled"
      sprint_status: "planning" | "active" | "completed" | "cancelled"
      task_stakeholder_role_type: "requester" | "executor"
      task_type:
        | "milestone"
        | "deliverable"
        | "work_item"
        | "decision"
        | "review"
      tenant_integration_kind:
        | "openai"
        | "azure_openai"
        | "microsoft_graph"
        | "sharepoint"
        | "sap"
        | "salesforce"
        | "mulesoft_kpi"
        | "smtp"
        | "webhook"
        | "storage_export"
        | "other"
      tenant_integration_status:
        | "not_configured"
        | "active"
        | "disabled"
        | "needs_reauth"
        | "error"
      tenant_role: "tenant_owner" | "tenant_admin" | "tenant_member"
      tenant_secret_audit_action:
        | "created"
        | "updated"
        | "rotated"
        | "disabled"
        | "revoked"
        | "resolved"
        | "tested"
        | "failed"
        | "deleted"
      tenant_secret_scope: "tenant" | "organization_override"
      tenant_secret_status:
        | "active"
        | "disabled"
        | "rotated"
        | "revoked"
        | "error"
      tenant_status:
        | "provisioning"
        | "active"
        | "suspended"
        | "archived"
        | "deletion_requested"
        | "retained"
        | "purged"
      workflow_state_category: "todo" | "in_progress" | "in_review" | "done"
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
      adoption_initiative_status: [
        "planned",
        "active",
        "at_risk",
        "completed",
        "cancelled",
      ],
      adoption_readiness_area: [
        "stakeholder_impact",
        "sponsor_alignment",
        "communication",
        "training_enablement",
        "feedback_collection",
        "adoption_tracking",
        "hypercare",
        "reinforcement_lessons",
      ],
      adoption_readiness_status: [
        "not_started",
        "preparing",
        "in_progress",
        "at_risk",
        "ready",
        "reinforced",
      ],
      app_role: [
        "org_admin",
        "workspace_admin",
        "project_manager",
        "contributor",
        "viewer",
      ],
      blocker_status: ["open", "in_progress", "resolved"],
      dependency_type: [
        "finish_to_start",
        "start_to_start",
        "finish_to_finish",
        "start_to_finish",
      ],
      environment_role: ["production", "non_production"],
      generated_doc_publish_status: [
        "not_published",
        "published",
        "publish_failed",
      ],
      generated_doc_status: ["generated_local", "generation_failed"],
      generated_doc_type: [
        "project_overview_charter",
        "weekly_project_status_deck",
        "roadmap_status_deck",
        "decision_case_word_brief",
        "decision_case_ppt_onepager",
        "project_closure_report",
      ],
      knowledge_article_status: ["draft", "published", "archived"],
      knowledge_article_type: [
        "concept",
        "how_to",
        "rulebook",
        "faq",
        "release_note",
        "admin",
        "integration_placeholder",
      ],
      knowledge_article_visibility: [
        "all_users",
        "admin_only",
        "workspace_scoped",
      ],
      kpi_target_direction: [
        "increase",
        "decrease",
        "maintain",
        "target_exact",
      ],
      membership_status: ["invited", "active", "suspended", "deactivated"],
      organization_kind: [
        "production",
        "qas",
        "test",
        "sandbox",
        "business_unit",
        "legal_entity",
        "other",
      ],
      organization_role: ["org_admin", "org_member"],
      phase_type: [
        "milestone",
        "deliverable",
        "work_item",
        "decision",
        "review",
      ],
      pm_priority: ["low", "medium", "high", "critical"],
      pm_status: ["planned", "active", "completed", "on_hold", "cancelled"],
      pmg_command_status: [
        "ready",
        "applied",
        "no_change",
        "confirmation_required",
        "conflict",
        "blocked",
        "not_authorized",
        "invalid",
      ],
      pmg_source_channel: [
        "btpm_ui",
        "admin_import",
        "external_api",
        "mcp",
        "background_job",
        "btpm_internal",
      ],
      project_delivery_model: [
        "internal_delivery",
        "vendor_delivery",
        "co_delivery",
      ],
      project_role: ["project_manager", "contributor", "viewer"],
      project_stage: ["initiation", "planning", "execution", "closure"],
      raci_role: ["responsible", "accountable", "consulted", "informed"],
      risk_likelihood: ["low", "medium", "high"],
      risk_status: [
        "identified",
        "mitigating",
        "accepted",
        "closed",
        "open",
        "under_mitigation",
        "monitoring",
        "realized",
      ],
      sharepoint_project_binding_mode: [
        "workspace_library_default",
        "restricted_library_override",
        "restricted_site_override",
      ],
      sharepoint_project_binding_status: [
        "linked_unvalidated",
        "validated",
        "invalid",
        "disabled",
      ],
      sharepoint_workspace_binding_status: [
        "configured_unvalidated",
        "validated",
        "invalid",
        "disabled",
      ],
      sprint_status: ["planning", "active", "completed", "cancelled"],
      task_stakeholder_role_type: ["requester", "executor"],
      task_type: [
        "milestone",
        "deliverable",
        "work_item",
        "decision",
        "review",
      ],
      tenant_integration_kind: [
        "openai",
        "azure_openai",
        "microsoft_graph",
        "sharepoint",
        "sap",
        "salesforce",
        "mulesoft_kpi",
        "smtp",
        "webhook",
        "storage_export",
        "other",
      ],
      tenant_integration_status: [
        "not_configured",
        "active",
        "disabled",
        "needs_reauth",
        "error",
      ],
      tenant_role: ["tenant_owner", "tenant_admin", "tenant_member"],
      tenant_secret_audit_action: [
        "created",
        "updated",
        "rotated",
        "disabled",
        "revoked",
        "resolved",
        "tested",
        "failed",
        "deleted",
      ],
      tenant_secret_scope: ["tenant", "organization_override"],
      tenant_secret_status: [
        "active",
        "disabled",
        "rotated",
        "revoked",
        "error",
      ],
      tenant_status: [
        "provisioning",
        "active",
        "suspended",
        "archived",
        "deletion_requested",
        "retained",
        "purged",
      ],
      workflow_state_category: ["todo", "in_progress", "in_review", "done"],
    },
  },
} as const
