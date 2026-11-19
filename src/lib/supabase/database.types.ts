/**
 * TypeScript types for the database, matching supabase/migrations/*.sql.
 *
 * Written by hand in the same shape the Supabase CLI generates, so we don't
 * need the CLI (a native binary) or a running project to build. When you
 * change a migration, update this file too. The migration tests in
 * tests/db/ catch SQL mistakes; TypeScript catches drift in app code.
 *
 * Optional regeneration once you have a project:
 *   npx supabase gen types typescript --project-id <id> > src/lib/supabase/database.types.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Timestamps = { created_at: string; updated_at: string };

export type ProfileRole = "user" | "admin";
export type ReferenceVisibility = "public" | "private";
export type ComparisonMode = "compare" | "identify" | "closest";
export type ComputedOn = "client";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          role: ProfileRole;
          settings: Json;
        } & Timestamps;
        Insert: never; // created by the on_auth_user_created trigger
        // Users may only update these two columns (column-level grant).
        Update: { display_name?: string | null; settings?: Json };
        Relationships: [];
      };
      reference_categories: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          sort_order: number;
        } & Timestamps;
        Insert: { id?: string; slug: string; name: string; description?: string | null; sort_order?: number };
        Update: { slug?: string; name?: string; description?: string | null; sort_order?: number };
        Relationships: [];
      };
      instruments: {
        Row: {
          id: string;
          slug: string;
          name: string;
          category_id: string;
          midi_min: number;
          midi_max: number;
          expected_note_count: number;
        } & Timestamps;
        Insert: {
          id?: string;
          slug: string;
          name: string;
          category_id: string;
          midi_min: number;
          midi_max: number;
          expected_note_count: number;
        };
        Update: {
          slug?: string;
          name?: string;
          category_id?: string;
          midi_min?: number;
          midi_max?: number;
          expected_note_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "instruments_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "reference_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      reference_sounds: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          category_id: string;
          tags: string[];
          storage_path: string;
          duration_ms: number;
          sample_rate: number;
          channels: number;
          format: "wav";
          original_filename: string | null;
          visibility: ReferenceVisibility;
          owner_id: string | null;
          license: string;
          source_url: string | null;
          attribution: string | null;
          is_synthetic: boolean;
          search: unknown; // tsvector; use .textSearch("search", …), never read directly
        } & Timestamps;
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          category_id: string;
          tags?: string[];
          storage_path: string;
          duration_ms: number;
          sample_rate: number;
          channels?: number;
          format?: "wav";
          original_filename?: string | null;
          visibility?: ReferenceVisibility;
          owner_id?: string | null;
          license: string;
          source_url?: string | null;
          attribution?: string | null;
          is_synthetic?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["reference_sounds"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "reference_sounds_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "reference_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reference_sounds_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      instrument_samples: {
        Row: {
          id: string;
          reference_sound_id: string;
          instrument_id: string;
          variant: string;
          midi_note: number;
          velocity: number | null;
          note_name: string; // generated from midi_note
          nominal_hz: number; // generated from midi_note (A4 = 440)
          created_at: string;
        };
        Insert: {
          id?: string;
          reference_sound_id: string;
          instrument_id: string;
          variant: string;
          midi_note: number;
          velocity?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["instrument_samples"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "instrument_samples_reference_sound_id_fkey";
            columns: ["reference_sound_id"];
            isOneToOne: true;
            referencedRelation: "reference_sounds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "instrument_samples_instrument_id_fkey";
            columns: ["instrument_id"];
            isOneToOne: false;
            referencedRelation: "instruments";
            referencedColumns: ["id"];
          },
        ];
      };
      reference_features: {
        Row: {
          id: string;
          reference_sound_id: string;
          strategy_id: string;
          algorithm_version: string;
          features: Json;
          computed_at: string;
        };
        Insert: {
          id?: string;
          reference_sound_id: string;
          strategy_id: string;
          algorithm_version: string;
          features: Json;
          computed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["reference_features"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "reference_features_reference_sound_id_fkey";
            columns: ["reference_sound_id"];
            isOneToOne: false;
            referencedRelation: "reference_sounds";
            referencedColumns: ["id"];
          },
        ];
      };
      comparisons: {
        Row: {
          id: string;
          user_id: string;
          mode: ComparisonMode;
          reference_sound_id: string | null;
          instrument_id: string | null;
          strategy_id: string;
          algorithm_version: string;
          score: number | null;
          title: string;
          result: Json;
          computed_on: ComputedOn;
          created_at: string;
        };
        // Inserted only by server code with the secret key (no user INSERT grant).
        Insert: {
          id?: string;
          user_id: string;
          mode: ComparisonMode;
          reference_sound_id?: string | null;
          instrument_id?: string | null;
          strategy_id: string;
          algorithm_version: string;
          score?: number | null;
          title: string;
          result: Json;
          computed_on?: ComputedOn;
        };
        Update: never; // history rows are immutable
        Relationships: [
          {
            foreignKeyName: "comparisons_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comparisons_reference_sound_id_fkey";
            columns: ["reference_sound_id"];
            isOneToOne: false;
            referencedRelation: "reference_sounds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comparisons_instrument_id_fkey";
            columns: ["instrument_id"];
            isOneToOne: false;
            referencedRelation: "instruments";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<never, never>;
    Functions: {
      is_admin: { Args: Record<never, never>; Returns: boolean };
      consume_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window_seconds: number };
        Returns: boolean;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
