
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "activity_events": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"event_type": string,"id": string,"metadata": NonNullable<Json>,"new_value": Json | null,"old_value": Json | null,"project_id": string | null,"task_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"event_type": string,"id"?: string,"metadata"?: NonNullable<Json>,"new_value"?: Json | null,"old_value"?: Json | null,"project_id"?: string | null,"task_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"event_type"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"new_value"?: Json | null,"old_value"?: Json | null,"project_id"?: string | null,"task_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_events_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_events_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_events_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"conversations": {
                  Row: {
                    "created_at": string,"id": string,"last_message_at": string | null,"last_read_a": string | null,"last_read_b": string | null,"user_a": string,"user_b": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"last_message_at"?: string | null,"last_read_a"?: string | null,"last_read_b"?: string | null,"user_a": string,"user_b": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"last_message_at"?: string | null,"last_read_a"?: string | null,"last_read_b"?: string | null,"user_a"?: string,"user_b"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversations_workspace_id_user_a_fkey"
      columns: ["workspace_id","user_a"]
isOneToOne: false
      referencedRelation: "workspace_members"
      referencedColumns: ["workspace_id","user_id"]
    },{
      foreignKeyName: "conversations_workspace_id_user_b_fkey"
      columns: ["workspace_id","user_b"]
isOneToOne: false
      referencedRelation: "workspace_members"
      referencedColumns: ["workspace_id","user_id"]
    }
                  ]
                },"departments": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"manager_id": string | null,"name": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"manager_id"?: string | null,"name": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"manager_id"?: string | null,"name"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "departments_manager_id_fkey"
      columns: ["manager_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "departments_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_user_id": string | null,"created_at": string,"department_id": string | null,"email": string,"expires_at": string,"full_name": string,"id": string,"invited_by": string | null,"role": Database["public"]['Enums']["workspace_role"],"status": Database["public"]['Enums']["invitation_status"],"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_user_id"?: string | null,"created_at"?: string,"department_id"?: string | null,"email": string,"expires_at"?: string,"full_name"?: string,"id"?: string,"invited_by"?: string | null,"role"?: Database["public"]['Enums']["workspace_role"],"status"?: Database["public"]['Enums']["invitation_status"],"workspace_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_user_id"?: string | null,"created_at"?: string,"department_id"?: string | null,"email"?: string,"expires_at"?: string,"full_name"?: string,"id"?: string,"invited_by"?: string | null,"role"?: Database["public"]['Enums']["workspace_role"],"status"?: Database["public"]['Enums']["invitation_status"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_accepted_user_id_fkey"
      columns: ["accepted_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_workspace_id_department_id_fkey"
      columns: ["workspace_id","department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "invitations_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"labels": {
                  Row: {
                    "color": string,"created_at": string,"created_by": string | null,"id": string,"name": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"workspace_id": string
                  }
                  Update: {
                    "color"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "labels_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "labels_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "body": string,"conversation_id": string,"created_at": string,"id": string,"sender_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"conversation_id": string,"created_at"?: string,"id"?: string,"sender_id": string
                  }
                  Update: {
                    "body"?: string,"conversation_id"?: string,"created_at"?: string,"id"?: string,"sender_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"data": NonNullable<Json>,"dedupe_key": string | null,"emailed_at": string | null,"id": string,"read_at": string | null,"recipient_id": string,"task_id": string | null,"type": Database["public"]['Enums']["notification_type"],"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"data"?: NonNullable<Json>,"dedupe_key"?: string | null,"emailed_at"?: string | null,"id"?: string,"read_at"?: string | null,"recipient_id": string,"task_id"?: string | null,"type": Database["public"]['Enums']["notification_type"],"workspace_id": string
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"data"?: NonNullable<Json>,"dedupe_key"?: string | null,"emailed_at"?: string | null,"id"?: string,"read_at"?: string | null,"recipient_id"?: string,"task_id"?: string | null,"type"?: Database["public"]['Enums']["notification_type"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_recipient_id_fkey"
      columns: ["recipient_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"email": string,"email_notifications": boolean,"full_name": string,"id": string,"job_title": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"email": string,"email_notifications"?: boolean,"full_name"?: string,"id": string,"job_title"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"email"?: string,"email_notifications"?: boolean,"full_name"?: string,"id"?: string,"job_title"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"project_members": {
                  Row: {
                    "added_at": string,"added_by": string | null,"project_id": string,"role": string,"user_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"added_by"?: string | null,"project_id": string,"role"?: string,"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "added_at"?: string,"added_by"?: string | null,"project_id"?: string,"role"?: string,"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_members_added_by_fkey"
      columns: ["added_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_members_profile_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_members_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "project_members_workspace_id_user_id_fkey"
      columns: ["workspace_id","user_id"]
isOneToOne: false
      referencedRelation: "workspace_members"
      referencedColumns: ["workspace_id","user_id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string | null,"description": string,"id": string,"is_private": boolean,"name": string,"owner_id": string | null,"start_date": string | null,"status": Database["public"]['Enums']["project_status"],"target_date": string | null,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string,"id"?: string,"is_private"?: boolean,"name": string,"owner_id"?: string | null,"start_date"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"target_date"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string,"id"?: string,"is_private"?: boolean,"name"?: string,"owner_id"?: string | null,"start_date"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"target_date"?: string | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_owner_profile_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_workspace_id_owner_id_fkey"
      columns: ["workspace_id","owner_id"]
isOneToOne: false
      referencedRelation: "workspace_members"
      referencedColumns: ["workspace_id","user_id"]
    }
                  ]
                },"task_assignments": {
                  Row: {
                    "changed_at": string,"changed_by": string | null,"id": string,"new_assignee_id": string | null,"note": string | null,"previous_assignee_id": string | null,"task_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "changed_at"?: string,"changed_by"?: string | null,"id"?: string,"new_assignee_id"?: string | null,"note"?: string | null,"previous_assignee_id"?: string | null,"task_id": string,"workspace_id": string
                  }
                  Update: {
                    "changed_at"?: string,"changed_by"?: string | null,"id"?: string,"new_assignee_id"?: string | null,"note"?: string | null,"previous_assignee_id"?: string | null,"task_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_assignments_changed_by_fkey"
      columns: ["changed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_assignments_new_assignee_id_fkey"
      columns: ["new_assignee_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_assignments_previous_assignee_id_fkey"
      columns: ["previous_assignee_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_assignments_workspace_id_task_id_fkey"
      columns: ["workspace_id","task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"task_attachments": {
                  Row: {
                    "created_at": string,"file_name": string,"id": string,"mime_type": string,"size_bytes": number,"storage_path": string,"task_id": string,"uploaded_by": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"file_name": string,"id"?: string,"mime_type": string,"size_bytes": number,"storage_path": string,"task_id": string,"uploaded_by"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"file_name"?: string,"id"?: string,"mime_type"?: string,"size_bytes"?: number,"storage_path"?: string,"task_id"?: string,"uploaded_by"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_attachments_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_attachments_workspace_id_task_id_fkey"
      columns: ["workspace_id","task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"task_collaborators": {
                  Row: {
                    "added_at": string,"added_by": string | null,"task_id": string,"user_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"added_by"?: string | null,"task_id": string,"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "added_at"?: string,"added_by"?: string | null,"task_id"?: string,"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_collaborators_added_by_fkey"
      columns: ["added_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_collaborators_profile_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_collaborators_workspace_id_task_id_fkey"
      columns: ["workspace_id","task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "task_collaborators_workspace_id_user_id_fkey"
      columns: ["workspace_id","user_id"]
isOneToOne: false
      referencedRelation: "workspace_members"
      referencedColumns: ["workspace_id","user_id"]
    }
                  ]
                },"task_comments": {
                  Row: {
                    "author_id": string | null,"body": string,"created_at": string,"deleted_at": string | null,"deleted_by": string | null,"edited_at": string | null,"id": string,"mentioned_user_ids": (string)[],"task_id": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body": string,"created_at"?: string,"deleted_at"?: string | null,"deleted_by"?: string | null,"edited_at"?: string | null,"id"?: string,"mentioned_user_ids"?: (string)[],"task_id": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"created_at"?: string,"deleted_at"?: string | null,"deleted_by"?: string | null,"edited_at"?: string | null,"id"?: string,"mentioned_user_ids"?: (string)[],"task_id"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_comments_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_comments_deleted_by_fkey"
      columns: ["deleted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_comments_workspace_id_task_id_fkey"
      columns: ["workspace_id","task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"task_dependencies": {
                  Row: {
                    "created_at": string,"created_by": string | null,"depends_on_task_id": string,"task_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"depends_on_task_id": string,"task_id": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"depends_on_task_id"?: string,"task_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_dependencies_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_dependencies_workspace_id_depends_on_task_id_fkey"
      columns: ["workspace_id","depends_on_task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "task_dependencies_workspace_id_task_id_fkey"
      columns: ["workspace_id","task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"task_labels": {
                  Row: {
                    "added_at": string,"label_id": string,"task_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"label_id": string,"task_id": string,"workspace_id": string
                  }
                  Update: {
                    "added_at"?: string,"label_id"?: string,"task_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_labels_workspace_id_label_id_fkey"
      columns: ["workspace_id","label_id"]
isOneToOne: false
      referencedRelation: "labels"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "task_labels_workspace_id_task_id_fkey"
      columns: ["workspace_id","task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "archived_at": string | null,"archived_by": string | null,"assigned_at": string | null,"assigned_by": string | null,"assignee_id": string | null,"blocker_description": string | null,"completed_at": string | null,"completed_by": string | null,"created_at": string,"creator_id": string | null,"department_id": string | null,"description": string,"due_date": string | null,"due_time": string | null,"estimate_hours": number | null,"id": string,"is_blocked": boolean,"key": string,"number": number,"parent_id": string | null,"priority": Database["public"]['Enums']["task_priority"],"progress": number,"project_id": string | null,"search_text": string | null,"start_date": string | null,"status": Database["public"]['Enums']["task_status"],"title": string,"updated_at": string,"updated_by": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"archived_by"?: string | null,"assigned_at"?: string | null,"assigned_by"?: string | null,"assignee_id"?: string | null,"blocker_description"?: string | null,"completed_at"?: string | null,"completed_by"?: string | null,"created_at"?: string,"creator_id"?: string | null,"department_id"?: string | null,"description"?: string,"due_date"?: string | null,"due_time"?: string | null,"estimate_hours"?: number | null,"id"?: string,"is_blocked"?: boolean,"key": string,"number": number,"parent_id"?: string | null,"priority"?: Database["public"]['Enums']["task_priority"],"progress"?: number,"project_id"?: string | null,"search_text"?: never,"start_date"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"title": string,"updated_at"?: string,"updated_by"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"archived_by"?: string | null,"assigned_at"?: string | null,"assigned_by"?: string | null,"assignee_id"?: string | null,"blocker_description"?: string | null,"completed_at"?: string | null,"completed_by"?: string | null,"created_at"?: string,"creator_id"?: string | null,"department_id"?: string | null,"description"?: string,"due_date"?: string | null,"due_time"?: string | null,"estimate_hours"?: number | null,"id"?: string,"is_blocked"?: boolean,"key"?: string,"number"?: number,"parent_id"?: string | null,"priority"?: Database["public"]['Enums']["task_priority"],"progress"?: number,"project_id"?: string | null,"search_text"?: never,"start_date"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"title"?: string,"updated_at"?: string,"updated_by"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_archived_by_fkey"
      columns: ["archived_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_assigned_by_fkey"
      columns: ["assigned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_assignee_profile_fkey"
      columns: ["assignee_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_completed_by_fkey"
      columns: ["completed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_creator_profile_fkey"
      columns: ["creator_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_workspace_id_assignee_id_fkey"
      columns: ["workspace_id","assignee_id"]
isOneToOne: false
      referencedRelation: "workspace_members"
      referencedColumns: ["workspace_id","user_id"]
    },{
      foreignKeyName: "tasks_workspace_id_creator_id_fkey"
      columns: ["workspace_id","creator_id"]
isOneToOne: false
      referencedRelation: "workspace_members"
      referencedColumns: ["workspace_id","user_id"]
    },{
      foreignKeyName: "tasks_workspace_id_department_id_fkey"
      columns: ["workspace_id","department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "tasks_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_workspace_id_parent_id_fkey"
      columns: ["workspace_id","parent_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "tasks_workspace_id_project_id_fkey"
      columns: ["workspace_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"todo_completions": {
                  Row: {
                    "completed_at": string,"day": string,"todo_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string,"day": string,"todo_id": string
                  }
                  Update: {
                    "completed_at"?: string,"day"?: string,"todo_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "todo_completions_todo_id_fkey"
      columns: ["todo_id"]
isOneToOne: false
      referencedRelation: "todos"
      referencedColumns: ["id"]
    }
                  ]
                },"todos": {
                  Row: {
                    "completed_at": string | null,"created_at": string,"due_date": string | null,"id": string,"repeat": Database["public"]['Enums']["todo_repeat"],"title": string,"user_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"created_at"?: string,"due_date"?: string | null,"id"?: string,"repeat"?: Database["public"]['Enums']["todo_repeat"],"title": string,"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "completed_at"?: string | null,"created_at"?: string,"due_date"?: string | null,"id"?: string,"repeat"?: Database["public"]['Enums']["todo_repeat"],"title"?: string,"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "todos_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "todos_workspace_id_user_id_fkey"
      columns: ["workspace_id","user_id"]
isOneToOne: false
      referencedRelation: "workspace_members"
      referencedColumns: ["workspace_id","user_id"]
    }
                  ]
                },"workspace_members": {
                  Row: {
                    "deactivated_at": string | null,"deactivated_by": string | null,"department_id": string | null,"is_active": boolean,"joined_at": string,"reports_to": string | null,"role": Database["public"]['Enums']["workspace_role"],"user_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "deactivated_at"?: string | null,"deactivated_by"?: string | null,"department_id"?: string | null,"is_active"?: boolean,"joined_at"?: string,"reports_to"?: string | null,"role"?: Database["public"]['Enums']["workspace_role"],"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "deactivated_at"?: string | null,"deactivated_by"?: string | null,"department_id"?: string | null,"is_active"?: boolean,"joined_at"?: string,"reports_to"?: string | null,"role"?: Database["public"]['Enums']["workspace_role"],"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_members_deactivated_by_fkey"
      columns: ["deactivated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workspace_members_reports_to_fkey"
      columns: ["workspace_id","reports_to"]
isOneToOne: false
      referencedRelation: "workspace_members"
      referencedColumns: ["workspace_id","user_id"]
    },{
      foreignKeyName: "workspace_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workspace_members_workspace_id_department_id_fkey"
      columns: ["workspace_id","department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "workspace_members_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspace_settings": {
                  Row: {
                    "assignment_policy": Database["public"]['Enums']["assignment_policy"],"auto_archive_done_after_days": number | null,"default_priority": Database["public"]['Enums']["task_priority"],"default_status": Database["public"]['Enums']["task_status"],"due_reminders_enabled": boolean,"due_soon_hours": number,"email_notifications_enabled": boolean,"employees_can_create_tasks": boolean,"self_signup_enabled": boolean,"signup_allowed_domains": (string)[],"signup_requires_approval": boolean,"task_visibility": Database["public"]['Enums']["task_visibility"],"timezone": string,"updated_at": string,"updated_by": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assignment_policy"?: Database["public"]['Enums']["assignment_policy"],"auto_archive_done_after_days"?: number | null,"default_priority"?: Database["public"]['Enums']["task_priority"],"default_status"?: Database["public"]['Enums']["task_status"],"due_reminders_enabled"?: boolean,"due_soon_hours"?: number,"email_notifications_enabled"?: boolean,"employees_can_create_tasks"?: boolean,"self_signup_enabled"?: boolean,"signup_allowed_domains"?: (string)[],"signup_requires_approval"?: boolean,"task_visibility"?: Database["public"]['Enums']["task_visibility"],"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "assignment_policy"?: Database["public"]['Enums']["assignment_policy"],"auto_archive_done_after_days"?: number | null,"default_priority"?: Database["public"]['Enums']["task_priority"],"default_status"?: Database["public"]['Enums']["task_status"],"due_reminders_enabled"?: boolean,"due_soon_hours"?: number,"email_notifications_enabled"?: boolean,"employees_can_create_tasks"?: boolean,"self_signup_enabled"?: boolean,"signup_allowed_domains"?: (string)[],"signup_requires_approval"?: boolean,"task_visibility"?: Database["public"]['Enums']["task_visibility"],"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_settings_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: true
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"slug": string,"task_counter": number,"task_prefix": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"slug": string,"task_counter"?: number,"task_prefix"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"slug"?: string,"task_counter"?: number,"task_prefix"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invitation":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"bulk_update_tasks":
{ Args: { "p_patch": Json,"p_task_ids": (string)[] }; Returns: number
                           },
"create_task":
{ Args: { "p_collaborator_ids"?: (string)[],"p_label_ids"?: (string)[],"p_note"?: string,"p_task": Json }; Returns: {
              "id": string,"key": string
            }[]
                           },
"dashboard_summary":
{ Args: { "p_from"?: string,"p_member"?: string,"p_to"?: string }; Returns: Json
                           },
"mark_conversation_read":
{ Args: { "p_conversation": string }; Returns: undefined
                           },
"open_conversation":
{ Args: { "p_other": string }; Returns: string
                           },
"people_in_scope":
{ Args: Record<PropertyKey, never>; Returns: {
              "email": string,"full_name": string,"reports_to": string,"user_id": string
            }[]
                           },
"project_progress":
{ Args: { "p_member"?: string }; Returns: {
              "done": number,"is_private": boolean,"name": string,"overdue": number,"project_id": string,"status": Database["public"]['Enums']["project_status"],"target_date": string,"total": number
            }[]
                           },
"set_todo_done":
{ Args: { "p_done": boolean,"p_todo": string }; Returns: undefined
                           },
"task_throughput":
{ Args: { "p_from": string,"p_member"?: string,"p_to": string }; Returns: {
              "completed": number,"created": number,"day": string
            }[]
                           },
"unread_conversation_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"update_task":
{ Args: { "p_collaborator_ids"?: (string)[],"p_label_ids"?: (string)[],"p_note"?: string,"p_patch"?: Json,"p_task_id": string }; Returns: undefined
                           },
"workload_by_member":
{ Args: { "p_from"?: string,"p_member"?: string,"p_to"?: string }; Returns: {
              "completed_count": number,"department_id": string,"email": string,"full_name": string,"in_progress_count": number,"in_review_count": number,"open_count": number,"overdue_count": number,"urgent_count": number,"user_id": string
            }[]
                           },
"workspace_today":
{ Args: Record<PropertyKey, never>; Returns: string
                           }
          }
          Enums: {
            "assignment_policy": "anyone"|"department"|"self","invitation_status": "pending"|"accepted"|"revoked","notification_type": "task_assigned"|"task_reassigned"|"collaborator_added"|"comment_added"|"mentioned"|"task_due_soon"|"task_overdue"|"task_completed"|"task_reopened"|"review_requested","project_status": "planning"|"active"|"on_hold"|"completed"|"cancelled","task_priority": "low"|"medium"|"high"|"urgent","task_status": "todo"|"in_progress"|"in_review"|"done","task_visibility": "all"|"participants","todo_repeat": "none"|"daily"|"weekdays","workspace_role": "admin"|"manager"|"employee"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "assignment_policy": ["anyone", "department", "self"],"invitation_status": ["pending", "accepted", "revoked"],"notification_type": ["task_assigned", "task_reassigned", "collaborator_added", "comment_added", "mentioned", "task_due_soon", "task_overdue", "task_completed", "task_reopened", "review_requested"],"project_status": ["planning", "active", "on_hold", "completed", "cancelled"],"task_priority": ["low", "medium", "high", "urgent"],"task_status": ["todo", "in_progress", "in_review", "done"],"task_visibility": ["all", "participants"],"todo_repeat": ["none", "daily", "weekdays"],"workspace_role": ["admin", "manager", "employee"]
          }
        }
} as const
