export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      customer_addresses: {
        Row: {
          city: string
          created_at: string
          customer_id: string
          floor_apt: string | null
          id: string
          is_default: boolean
          label: string | null
          postal_code: string
          street: string
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          city?: string
          created_at?: string
          customer_id: string
          floor_apt?: string | null
          id?: string
          is_default?: boolean
          label?: string | null
          postal_code: string
          street: string
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          city?: string
          created_at?: string
          customer_id?: string
          floor_apt?: string | null
          id?: string
          is_default?: boolean
          label?: string | null
          postal_code?: string
          street?: string
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_events: {
        Row: {
          actor_id: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          at: string
          customer_id: string
          id: string
          payload: Json
          type: string
        }
        Insert: {
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          at?: string
          customer_id: string
          id?: string
          payload?: Json
          type: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          at?: string
          customer_id?: string
          id?: string
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          anonymised_at: string | null
          birthday: string | null
          consent_email: Json | null
          consent_phone: Json | null
          consent_push: Json | null
          created_at: string
          email: string | null
          id: string
          is_company: boolean
          kitchen_note: string | null
          name: string
          phone: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          anonymised_at?: string | null
          birthday?: string | null
          consent_email?: Json | null
          consent_phone?: Json | null
          consent_push?: Json | null
          created_at?: string
          email?: string | null
          id?: string
          is_company?: boolean
          kitchen_note?: string | null
          name: string
          phone: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          anonymised_at?: string | null
          birthday?: string | null
          consent_email?: Json | null
          consent_phone?: Json | null
          consent_push?: Json | null
          created_at?: string
          email?: string | null
          id?: string
          is_company?: boolean
          kitchen_note?: string | null
          name?: string
          phone?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      delivery_zones: {
        Row: {
          active: boolean
          areas: string | null
          code: string
          created_at: string
          fee_cents: number
          free_delivery_over_cents: number | null
          id: string
          min_order_cents: number
          name: string
          postal_codes: string[]
          promised_minutes: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          areas?: string | null
          code: string
          created_at?: string
          fee_cents?: number
          free_delivery_over_cents?: number | null
          id?: string
          min_order_cents?: number
          name: string
          postal_codes?: string[]
          promised_minutes: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          areas?: string | null
          code?: string
          created_at?: string
          fee_cents?: number
          free_delivery_over_cents?: number | null
          id?: string
          min_order_cents?: number
          name?: string
          postal_codes?: string[]
          promised_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      menu_categories: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name_de: string
          name_en: string
          name_ja: string | null
          schedule: Json | null
          slug: string
          sort: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name_de: string
          name_en: string
          name_ja?: string | null
          schedule?: Json | null
          slug: string
          sort?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name_de?: string
          name_en?: string
          name_ja?: string | null
          schedule?: Json | null
          slug?: string
          sort?: number
          updated_at?: string
        }
        Relationships: []
      }
      menu_item_option_groups: {
        Row: {
          group_id: string
          item_id: string
          sort: number
        }
        Insert: {
          group_id: string
          item_id: string
          sort?: number
        }
        Update: {
          group_id?: string
          item_id?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_option_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "option_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_option_groups_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_option_groups_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items_on_sale"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          allergens: string[]
          available: boolean
          base_price_cents: number
          category_id: string
          cost_cents: number | null
          created_at: string
          description_de: string | null
          description_en: string | null
          id: string
          kcal_per_100g: number | null
          kitchen_note: string | null
          max_per_order: number | null
          name_de: string
          name_en: string
          name_ja: string | null
          photos: Json
          prep_minutes: number | null
          recommended_item_ids: string[]
          sku: string
          sort: number
          station: string | null
          stock_remaining: number | null
          stoplist_until: string | null
          tags: string[]
          transliteration: string | null
          updated_at: string
          vat_delivery_pct: number
          vat_onsite_pct: number
          weight_g: number | null
        }
        Insert: {
          allergens?: string[]
          available?: boolean
          base_price_cents: number
          category_id: string
          cost_cents?: number | null
          created_at?: string
          description_de?: string | null
          description_en?: string | null
          id?: string
          kcal_per_100g?: number | null
          kitchen_note?: string | null
          max_per_order?: number | null
          name_de: string
          name_en: string
          name_ja?: string | null
          photos?: Json
          prep_minutes?: number | null
          recommended_item_ids?: string[]
          sku: string
          sort?: number
          station?: string | null
          stock_remaining?: number | null
          stoplist_until?: string | null
          tags?: string[]
          transliteration?: string | null
          updated_at?: string
          vat_delivery_pct?: number
          vat_onsite_pct?: number
          weight_g?: number | null
        }
        Update: {
          allergens?: string[]
          available?: boolean
          base_price_cents?: number
          category_id?: string
          cost_cents?: number | null
          created_at?: string
          description_de?: string | null
          description_en?: string | null
          id?: string
          kcal_per_100g?: number | null
          kitchen_note?: string | null
          max_per_order?: number | null
          name_de?: string
          name_en?: string
          name_ja?: string | null
          photos?: Json
          prep_minutes?: number | null
          recommended_item_ids?: string[]
          sku?: string
          sort?: number
          station?: string | null
          stock_remaining?: number | null
          stoplist_until?: string | null
          tags?: string[]
          transliteration?: string | null
          updated_at?: string
          vat_delivery_pct?: number
          vat_onsite_pct?: number
          weight_g?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      option_groups: {
        Row: {
          created_at: string
          id: string
          max_select: number | null
          min_select: number
          name_de: string
          name_en: string
          required: boolean
          shared: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_select?: number | null
          min_select?: number
          name_de: string
          name_en: string
          required?: boolean
          shared?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          max_select?: number | null
          min_select?: number
          name_de?: string
          name_en?: string
          required?: boolean
          shared?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      options: {
        Row: {
          active: boolean
          created_at: string
          group_id: string
          id: string
          name_de: string
          name_en: string
          price_cents: number
          sort: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          group_id: string
          id?: string
          name_de: string
          name_en: string
          price_cents?: number
          sort?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          group_id?: string
          id?: string
          name_de?: string
          name_en?: string
          price_cents?: number
          sort?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "option_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          actor_id: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          at: string
          id: string
          order_id: string
          payload: Json
          type: string
        }
        Insert: {
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          at?: string
          id?: string
          order_id: string
          payload?: Json
          type: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          at?: string
          id?: string
          order_id?: string
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          item_id: string | null
          line_total_cents: number
          modified_by_operator: boolean
          name: string
          options: Json
          order_id: string
          qty: number
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id?: string | null
          line_total_cents: number
          modified_by_operator?: boolean
          name: string
          options?: Json
          order_id: string
          qty: number
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string | null
          line_total_cents?: number
          modified_by_operator?: boolean
          name?: string
          options?: Json
          order_id?: string
          qty?: number
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items_on_sale"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          address: Json | null
          allergy_note: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          channel: Database["public"]["Enums"]["order_channel"]
          comment_flags: string[]
          completed_at: string | null
          contact_name: string
          contact_phone: string
          courier_comment: string | null
          created_at: string
          customer_id: string | null
          delivery_fee_cents: number
          discount_cents: number
          distance_km: number | null
          driver_id: string | null
          id: string
          number: number
          out_at: string | null
          payment_authorized_cents: number | null
          payment_captured_at: string | null
          payment_intent_id: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_provider: string | null
          payment_ref: string | null
          payment_refunded_cents: number
          payment_status: Database["public"]["Enums"]["payment_status"]
          preparing_at: string | null
          promised_minutes: number | null
          promo_code: string | null
          ready_at: string | null
          scheduled_for: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal_cents: number
          tip_cents: number
          total_cents: number
          tracking_token: string
          type: Database["public"]["Enums"]["order_type"]
          updated_at: string
          vat_cents: number
          zone_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          address?: Json | null
          allergy_note?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          channel?: Database["public"]["Enums"]["order_channel"]
          comment_flags?: string[]
          completed_at?: string | null
          contact_name: string
          contact_phone: string
          courier_comment?: string | null
          created_at?: string
          customer_id?: string | null
          delivery_fee_cents?: number
          discount_cents?: number
          distance_km?: number | null
          driver_id?: string | null
          id?: string
          number?: number
          out_at?: string | null
          payment_authorized_cents?: number | null
          payment_captured_at?: string | null
          payment_intent_id?: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_provider?: string | null
          payment_ref?: string | null
          payment_refunded_cents?: number
          payment_status?: Database["public"]["Enums"]["payment_status"]
          preparing_at?: string | null
          promised_minutes?: number | null
          promo_code?: string | null
          ready_at?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cents?: number
          tip_cents?: number
          total_cents?: number
          tracking_token?: string
          type: Database["public"]["Enums"]["order_type"]
          updated_at?: string
          vat_cents?: number
          zone_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          address?: Json | null
          allergy_note?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          channel?: Database["public"]["Enums"]["order_channel"]
          comment_flags?: string[]
          completed_at?: string | null
          contact_name?: string
          contact_phone?: string
          courier_comment?: string | null
          created_at?: string
          customer_id?: string | null
          delivery_fee_cents?: number
          discount_cents?: number
          distance_km?: number | null
          driver_id?: string | null
          id?: string
          number?: number
          out_at?: string | null
          payment_authorized_cents?: number | null
          payment_captured_at?: string | null
          payment_intent_id?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_provider?: string | null
          payment_ref?: string | null
          payment_refunded_cents?: number
          payment_status?: Database["public"]["Enums"]["payment_status"]
          preparing_at?: string | null
          promised_minutes?: number | null
          promo_code?: string | null
          ready_at?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cents?: number
          tip_cents?: number
          total_cents?: number
          tracking_token?: string
          type?: Database["public"]["Enums"]["order_type"]
          updated_at?: string
          vat_cents?: number
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_stats"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          event_id: string
          id: string
          order_id: string | null
          payload: Json
          provider: string
          received_at: string
          type: string
        }
        Insert: {
          event_id: string
          id?: string
          order_id?: string | null
          payload?: Json
          provider?: string
          received_at?: string
          type: string
        }
        Update: {
          event_id?: string
          id?: string
          order_id?: string | null
          payload?: Json
          provider?: string
          received_at?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_jobs: {
        Row: {
          action: Database["public"]["Enums"]["payment_job_action"]
          amount_cents: number | null
          attempts: number
          created_at: string
          finished_at: string | null
          id: string
          last_error: string | null
          order_id: string
          result: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["payment_job_status"]
          updated_at: string
        }
        Insert: {
          action: Database["public"]["Enums"]["payment_job_action"]
          amount_cents?: number | null
          attempts?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          order_id: string
          result?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["payment_job_status"]
          updated_at?: string
        }
        Update: {
          action?: Database["public"]["Enums"]["payment_job_action"]
          amount_cents?: number | null
          attempts?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          order_id?: string
          result?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["payment_job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          active: boolean
          applies_to: Json
          code: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["promo_kind"]
          min_order_cents: number
          updated_at: string
          usage_limit: number | null
          used_count: number
          valid_from: string | null
          valid_to: string | null
          value: number
        }
        Insert: {
          active?: boolean
          applies_to?: Json
          code: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["promo_kind"]
          min_order_cents?: number
          updated_at?: string
          usage_limit?: number | null
          used_count?: number
          valid_from?: string | null
          valid_to?: string | null
          value: number
        }
        Update: {
          active?: boolean
          applies_to?: Json
          code?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["promo_kind"]
          min_order_cents?: number
          updated_at?: string
          usage_limit?: number | null
          used_count?: number
          valid_from?: string | null
          valid_to?: string | null
          value?: number
        }
        Relationships: []
      }
      settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      staff: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          phone: string | null
          role: Database["public"]["Enums"]["staff_role"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id: string
          name: string
          phone?: string | null
          role: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      customer_stats: {
        Row: {
          avg_cents: number | null
          customer_id: string | null
          days_silent: number | null
          last_order_at: string | null
          orders_count: number | null
          spent_cents: number | null
        }
        Relationships: []
      }
      menu_items_on_sale: {
        Row: {
          allergens: string[] | null
          available: boolean | null
          base_price_cents: number | null
          category_id: string | null
          cost_cents: number | null
          created_at: string | null
          description_de: string | null
          description_en: string | null
          id: string | null
          kcal_per_100g: number | null
          kitchen_note: string | null
          max_per_order: number | null
          name_de: string | null
          name_en: string | null
          name_ja: string | null
          photos: Json | null
          prep_minutes: number | null
          recommended_item_ids: string[] | null
          sku: string | null
          sort: number | null
          station: string | null
          stock_remaining: number | null
          stoplist_until: string | null
          tags: string[] | null
          transliteration: string | null
          updated_at: string | null
          vat_delivery_pct: number | null
          vat_onsite_pct: number | null
          weight_g: number | null
        }
        Insert: {
          allergens?: string[] | null
          available?: boolean | null
          base_price_cents?: number | null
          category_id?: string | null
          cost_cents?: number | null
          created_at?: string | null
          description_de?: string | null
          description_en?: string | null
          id?: string | null
          kcal_per_100g?: number | null
          kitchen_note?: string | null
          max_per_order?: number | null
          name_de?: string | null
          name_en?: string | null
          name_ja?: string | null
          photos?: Json | null
          prep_minutes?: number | null
          recommended_item_ids?: string[] | null
          sku?: string | null
          sort?: number | null
          station?: string | null
          stock_remaining?: number | null
          stoplist_until?: string | null
          tags?: string[] | null
          transliteration?: string | null
          updated_at?: string | null
          vat_delivery_pct?: number | null
          vat_onsite_pct?: number | null
          weight_g?: number | null
        }
        Update: {
          allergens?: string[] | null
          available?: boolean | null
          base_price_cents?: number | null
          category_id?: string | null
          cost_cents?: number | null
          created_at?: string | null
          description_de?: string | null
          description_en?: string | null
          id?: string | null
          kcal_per_100g?: number | null
          kitchen_note?: string | null
          max_per_order?: number | null
          name_de?: string | null
          name_en?: string | null
          name_ja?: string | null
          photos?: Json | null
          prep_minutes?: number | null
          recommended_item_ids?: string[] | null
          sku?: string | null
          sort?: number | null
          station?: string | null
          stock_remaining?: number | null
          stoplist_until?: string | null
          tags?: string[] | null
          transliteration?: string | null
          updated_at?: string | null
          vat_delivery_pct?: number | null
          vat_onsite_pct?: number | null
          weight_g?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_customer_event: {
        Args: { customer_id: string; payload?: Json; type: string }
        Returns: Json
      }
      anonymise_silent_customers: { Args: { months?: number }; Returns: number }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      claim_payment_jobs: {
        Args: { p_limit?: number }
        Returns: {
          action: Database["public"]["Enums"]["payment_job_action"]
          amount_cents: number | null
          attempts: number
          created_at: string
          finished_at: string | null
          id: string
          last_error: string | null
          order_id: string
          result: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["payment_job_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "payment_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      current_actor: { Args: never; Returns: Record<string, unknown> }
      enqueue_payment_job: {
        Args: {
          p_action: Database["public"]["Enums"]["payment_job_action"]
          p_amount_cents?: number
          p_order_id: string
        }
        Returns: string
      }
      ensure_guest_realtime_policy: { Args: never; Returns: Json }
      ensure_menu_bucket_policies: { Args: never; Returns: boolean }
      finish_payment_job: {
        Args: {
          p_error?: string
          p_final?: boolean
          p_job_id: string
          p_ok: boolean
          p_result?: Json
        }
        Returns: {
          action: Database["public"]["Enums"]["payment_job_action"]
          amount_cents: number | null
          attempts: number
          created_at: string
          finished_at: string | null
          id: string
          last_error: string | null
          order_id: string
          result: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["payment_job_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_order_by_token: { Args: { token: string }; Returns: Json }
      is_service_request: { Args: never; Returns: boolean }
      is_staff: {
        Args: { roles: Database["public"]["Enums"]["staff_role"][] }
        Returns: boolean
      }
      kitchen_pause: { Args: { paused: boolean }; Returns: Json }
      menu_item_on_sale: {
        Args: { item: Database["public"]["Tables"]["menu_items"]["Row"] }
        Returns: boolean
      }
      normalize_phone: { Args: { raw: string }; Returns: string }
      order_transition_allowed: {
        Args: {
          from_status: Database["public"]["Enums"]["order_status"]
          otype: Database["public"]["Enums"]["order_type"]
          pstatus: Database["public"]["Enums"]["payment_status"]
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Returns: boolean
      }
      place_order: { Args: { payload: Json }; Returns: Json }
      quote_order: { Args: { payload: Json }; Returns: Json }
      record_payment_event: {
        Args: {
          p_event_id: string
          p_order_id?: string
          p_payload: Json
          p_payment_intent_id?: string
          p_payment_method?: Database["public"]["Enums"]["payment_method"]
          p_payment_ref?: string
          p_provider: string
          p_type: string
        }
        Returns: Json
      }
      run_payment_worker: { Args: never; Returns: undefined }
      schedule_payment_worker: {
        Args: { p_anon_key: string; p_url: string }
        Returns: Json
      }
      set_order_status: {
        Args: {
          new_status: Database["public"]["Enums"]["order_status"]
          order_id: string
          payload?: Json
        }
        Returns: Json
      }
      settings_public_keys: { Args: never; Returns: string[] }
      shop_open_at: { Args: { ts: string }; Returns: boolean }
      update_order_items: {
        Args: { items: Json; order_id: string }
        Returns: Json
      }
    }
    Enums: {
      actor_type: "customer" | "staff" | "system"
      order_channel:
        | "website"
        | "phone"
        | "instagram"
        | "facebook"
        | "lieferando"
        | "wolt"
      order_status:
        | "new"
        | "accepted"
        | "preparing"
        | "ready"
        | "out_for_delivery"
        | "delivered"
        | "picked_up"
        | "cancelled"
        | "refunded"
      order_type: "delivery" | "pickup"
      payment_job_action: "capture" | "void" | "refund" | "update_amount"
      payment_job_status: "queued" | "processing" | "done" | "failed"
      payment_method:
        | "card"
        | "apple_pay"
        | "google_pay"
        | "paypal"
        | "bitcoin"
        | "cash"
      payment_status: "pending" | "authorized" | "paid" | "failed" | "refunded"
      promo_kind: "percent" | "fixed"
      staff_role: "owner" | "operator" | "kitchen" | "driver"
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
      actor_type: ["customer", "staff", "system"],
      order_channel: [
        "website",
        "phone",
        "instagram",
        "facebook",
        "lieferando",
        "wolt",
      ],
      order_status: [
        "new",
        "accepted",
        "preparing",
        "ready",
        "out_for_delivery",
        "delivered",
        "picked_up",
        "cancelled",
        "refunded",
      ],
      order_type: ["delivery", "pickup"],
      payment_job_action: ["capture", "void", "refund", "update_amount"],
      payment_job_status: ["queued", "processing", "done", "failed"],
      payment_method: [
        "card",
        "apple_pay",
        "google_pay",
        "paypal",
        "bitcoin",
        "cash",
      ],
      payment_status: ["pending", "authorized", "paid", "failed", "refunded"],
      promo_kind: ["percent", "fixed"],
      staff_role: ["owner", "operator", "kitchen", "driver"],
    },
  },
} as const

