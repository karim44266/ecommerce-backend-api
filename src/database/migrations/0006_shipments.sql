CREATE TABLE IF NOT EXISTS "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL UNIQUE,
	"staff_user_id" uuid NOT NULL,
	"status" text DEFAULT 'ASSIGNED' NOT NULL,
	"tracking_number" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "shipments" ADD CONSTRAINT "shipments_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_order_idx" ON "shipments" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_staff_idx" ON "shipments" USING btree ("staff_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_status_idx" ON "shipments" USING btree ("status");
