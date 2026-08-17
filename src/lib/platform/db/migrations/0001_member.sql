CREATE TABLE "core"."member_alias" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "core"."member" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'active' NOT NULL,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_email_normalized" CHECK ("core"."member"."email" = lower(btrim("core"."member"."email"))),
	CONSTRAINT "member_status_allowed" CHECK ("core"."member"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "core"."member_alias" ADD CONSTRAINT "member_alias_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "core"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_alias_kind_value_unique" ON "core"."member_alias" USING btree ("kind",lower(btrim("value")));--> statement-breakpoint
CREATE UNIQUE INDEX "member_slug_unique" ON "core"."member" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "member_email_unique" ON "core"."member" USING btree ("email");