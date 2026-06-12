import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_public_projects_status" AS ENUM('active', 'launching', 'exploring', 'soon');
  CREATE TYPE "public"."enum_public_projects_maturity" AS ENUM('rich', 'thin', 'soon');
  CREATE TYPE "public"."enum_public_projects_visibility" AS ENUM('public', 'restricted');
  CREATE TYPE "public"."enum_public_projects_locale" AS ENUM('ru', 'en');
  CREATE TYPE "public"."enum_team_locale" AS ENUM('ru', 'en');
  CREATE TYPE "public"."enum_pages_trust_stats_tone" AS ENUM('default', 'teal', 'empty');
  CREATE TYPE "public"."enum_pages_participate_forms_fields_type" AS ENUM('text', 'email', 'tel', 'select', 'textarea');
  CREATE TYPE "public"."enum_pages_locale" AS ENUM('ru', 'en');
  CREATE TYPE "public"."enum_philosophy_locale" AS ENUM('ru', 'en');
  CREATE TYPE "public"."enum_contact_locale" AS ENUM('ru', 'en');
  CREATE TYPE "public"."enum_site_chrome_locale" AS ENUM('ru', 'en');
  CREATE TABLE "public_projects_metrics" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"value" varchar
  );
  
  CREATE TABLE "public_projects" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"tagline" varchar NOT NULL,
  	"direction" varchar NOT NULL,
  	"status" "enum_public_projects_status" NOT NULL,
  	"maturity" "enum_public_projects_maturity" NOT NULL,
  	"description" varchar,
  	"disclaimer" varchar,
  	"media_logo" varchar,
  	"next_step_label" varchar,
  	"next_step_href" varchar,
  	"visibility" "enum_public_projects_visibility" DEFAULT 'public',
  	"locale" "enum_public_projects_locale" DEFAULT 'ru' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "public_projects_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" varchar NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "public_projects_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" varchar NOT NULL,
  	"path" varchar NOT NULL,
  	"team_id" varchar
  );
  
  CREATE TABLE "team_socials" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"href" varchar
  );
  
  CREATE TABLE "team" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"initials" varchar,
  	"role" varchar,
  	"bio" varchar,
  	"photo" varchar,
  	"locale" "enum_team_locale" DEFAULT 'ru' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "team_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" varchar NOT NULL,
  	"path" varchar NOT NULL,
  	"public_projects_id" varchar
  );
  
  CREATE TABLE "pages_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"question" varchar,
  	"answer" varchar
  );
  
  CREATE TABLE "pages_path_steps" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar
  );
  
  CREATE TABLE "pages_hero_proof_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"icon" varchar,
  	"title" varchar,
  	"body" varchar
  );
  
  CREATE TABLE "pages_intro_actions" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"href" varchar
  );
  
  CREATE TABLE "pages_trust_stats" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"value" varchar,
  	"label" varchar,
  	"sub" varchar,
  	"tone" "enum_pages_trust_stats_tone"
  );
  
  CREATE TABLE "pages_participate_forms_fields_options" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"value" varchar,
  	"label" varchar
  );
  
  CREATE TABLE "pages_participate_forms_fields" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"type" "enum_pages_participate_forms_fields_type" NOT NULL,
  	"label" varchar,
  	"placeholder" varchar,
  	"hint" varchar,
  	"required" boolean,
  	"full" boolean,
  	"autocomplete" varchar,
  	"validation_message" varchar,
  	"placeholder_option" varchar
  );
  
  CREATE TABLE "pages_participate_forms" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"scenario" varchar,
  	"eyebrow" varchar,
  	"title" varchar,
  	"lead" varchar,
  	"consent_label_lead" varchar,
  	"consent_link_text" varchar,
  	"consent_validation_message" varchar,
  	"submit_label" varchar,
  	"states_success_title" varchar,
  	"states_success_body" varchar,
  	"states_error_title" varchar,
  	"states_error_body" varchar,
  	"states_unavailable_title" varchar,
  	"states_unavailable_body" varchar,
  	"note" varchar
  );
  
  CREATE TABLE "pages_privacy_sections" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar
  );
  
  CREATE TABLE "pages" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"hero_eyebrow" varchar,
  	"hero_sticker" varchar,
  	"hero_title_lead" varchar,
  	"hero_title_mark" varchar,
  	"hero_title_trail" varchar,
  	"hero_lead" varchar,
  	"hero_primary_cta_label" varchar,
  	"hero_primary_cta_href" varchar,
  	"hero_secondary_cta_label" varchar,
  	"hero_secondary_cta_href" varchar,
  	"hero_proof_label" varchar,
  	"what_is_eyebrow" varchar,
  	"what_is_title" varchar,
  	"showcase_eyebrow" varchar,
  	"showcase_title" varchar,
  	"showcase_lead" varchar,
  	"showcase_all_link_label" varchar,
  	"showcase_all_link_href" varchar,
  	"intro_eyebrow" varchar,
  	"intro_title" varchar,
  	"intro_lead" varchar,
  	"filters_label" varchar,
  	"filters_all_label" varchar,
  	"about_what_is_eyebrow" varchar,
  	"about_what_is_title" varchar,
  	"about_what_is_lead" varchar,
  	"about_goal_eyebrow" varchar,
  	"about_goal_title" varchar,
  	"about_goal_lead" varchar,
  	"about_values_eyebrow" varchar,
  	"about_values_title" varchar,
  	"about_values_lead" varchar,
  	"about_principles_eyebrow" varchar,
  	"about_principles_title" varchar,
  	"about_principles_lead" varchar,
  	"about_approach_eyebrow" varchar,
  	"about_approach_title" varchar,
  	"about_approach_lead" varchar,
  	"about_roles_eyebrow" varchar,
  	"about_roles_title" varchar,
  	"about_roles_lead" varchar,
  	"about_goal_kicker" varchar,
  	"about_mission_kicker" varchar,
  	"about_approach_note_title" varchar,
  	"about_approach_note_body" varchar,
  	"path_intro_eyebrow" varchar,
  	"path_intro_title" varchar,
  	"path_intro_lead" varchar,
  	"trust_eyebrow" varchar,
  	"trust_title" varchar,
  	"trust_lead" varchar,
  	"contour_eyebrow" varchar,
  	"contour_title" varchar,
  	"contour_public_kicker" varchar,
  	"contour_public_title" varchar,
  	"contour_internal_kicker" varchar,
  	"contour_internal_title" varchar,
  	"contour_boundary" varchar,
  	"faq_intro_eyebrow" varchar,
  	"faq_intro_title" varchar,
  	"contacts_eyebrow" varchar,
  	"contacts_title" varchar,
  	"contacts_lead" varchar,
  	"contacts_boundary_icon" varchar,
  	"contacts_boundary_label" varchar,
  	"contacts_boundary_value" varchar,
  	"contacts_note" varchar,
  	"team_eyebrow" varchar,
  	"team_title" varchar,
  	"team_lead" varchar,
  	"participate_roles_slug" varchar,
  	"participate_roles_eyebrow" varchar,
  	"participate_roles_title" varchar,
  	"participate_roles_lead" varchar,
  	"participate_no_script_message" varchar,
  	"participate_no_script_link_text" varchar,
  	"participate_no_script_contacts_link_text" varchar,
  	"privacy_draft_note_label" varchar,
  	"privacy_draft_note_body" varchar,
  	"privacy_operator_slug" varchar,
  	"privacy_operator_heading" varchar,
  	"privacy_consent_anchor" varchar,
  	"privacy_consent_label" varchar,
  	"cta_title" varchar,
  	"cta_lead" varchar,
  	"cta_primary_cta_label" varchar,
  	"cta_primary_cta_href" varchar,
  	"cta_secondary_cta_label" varchar,
  	"cta_secondary_cta_href" varchar,
  	"locale" "enum_pages_locale" DEFAULT 'ru' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "pages_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" varchar NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "philosophy_values" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar,
  	"icon" varchar
  );
  
  CREATE TABLE "philosophy_principles" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar
  );
  
  CREATE TABLE "philosophy_teal_pillars" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar,
  	"icon" varchar
  );
  
  CREATE TABLE "philosophy_roles" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"code" varchar,
  	"icon" varchar,
  	"share" varchar,
  	"extra" varchar,
  	"body" varchar,
  	"hot" boolean
  );
  
  CREATE TABLE "philosophy" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"evolutionary_goal" varchar,
  	"mission" varchar,
  	"locale" "enum_philosophy_locale" DEFAULT 'ru' NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "contact_socials" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"href" varchar
  );
  
  CREATE TABLE "contact" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"email" varchar NOT NULL,
  	"phone" varchar,
  	"legal_entity" varchar,
  	"domain" varchar,
  	"locale" "enum_contact_locale" DEFAULT 'ru' NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "site_chrome_nav" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"href" varchar
  );
  
  CREATE TABLE "site_chrome_footer_columns_links" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"href" varchar
  );
  
  CREATE TABLE "site_chrome_footer_columns" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar
  );
  
  CREATE TABLE "site_chrome" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"login_label" varchar,
  	"login_href" varchar,
  	"cta_label" varchar,
  	"cta_href" varchar,
  	"footer_tagline" varchar,
  	"copyright" varchar,
  	"locale" "enum_site_chrome_locale" DEFAULT 'ru' NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "public_projects_id" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "team_id" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "pages_id" varchar;
  ALTER TABLE "public_projects_metrics" ADD CONSTRAINT "public_projects_metrics_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."public_projects"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "public_projects_texts" ADD CONSTRAINT "public_projects_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."public_projects"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "public_projects_rels" ADD CONSTRAINT "public_projects_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."public_projects"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "public_projects_rels" ADD CONSTRAINT "public_projects_rels_team_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "team_socials" ADD CONSTRAINT "team_socials_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "team_rels" ADD CONSTRAINT "team_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "team_rels" ADD CONSTRAINT "team_rels_public_projects_fk" FOREIGN KEY ("public_projects_id") REFERENCES "public"."public_projects"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_faq" ADD CONSTRAINT "pages_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_path_steps" ADD CONSTRAINT "pages_path_steps_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_hero_proof_items" ADD CONSTRAINT "pages_hero_proof_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_intro_actions" ADD CONSTRAINT "pages_intro_actions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_trust_stats" ADD CONSTRAINT "pages_trust_stats_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_participate_forms_fields_options" ADD CONSTRAINT "pages_participate_forms_fields_options_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_participate_forms_fields"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_participate_forms_fields" ADD CONSTRAINT "pages_participate_forms_fields_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_participate_forms"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_participate_forms" ADD CONSTRAINT "pages_participate_forms_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_privacy_sections" ADD CONSTRAINT "pages_privacy_sections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_texts" ADD CONSTRAINT "pages_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "philosophy_values" ADD CONSTRAINT "philosophy_values_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."philosophy"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "philosophy_principles" ADD CONSTRAINT "philosophy_principles_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."philosophy"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "philosophy_teal_pillars" ADD CONSTRAINT "philosophy_teal_pillars_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."philosophy"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "philosophy_roles" ADD CONSTRAINT "philosophy_roles_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."philosophy"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "contact_socials" ADD CONSTRAINT "contact_socials_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_chrome_nav" ADD CONSTRAINT "site_chrome_nav_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."site_chrome"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_chrome_footer_columns_links" ADD CONSTRAINT "site_chrome_footer_columns_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."site_chrome_footer_columns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_chrome_footer_columns" ADD CONSTRAINT "site_chrome_footer_columns_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."site_chrome"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "public_projects_metrics_order_idx" ON "public_projects_metrics" USING btree ("_order");
  CREATE INDEX "public_projects_metrics_parent_id_idx" ON "public_projects_metrics" USING btree ("_parent_id");
  CREATE INDEX "public_projects_updated_at_idx" ON "public_projects" USING btree ("updated_at");
  CREATE INDEX "public_projects_created_at_idx" ON "public_projects" USING btree ("created_at");
  CREATE INDEX "public_projects_texts_order_parent" ON "public_projects_texts" USING btree ("order","parent_id");
  CREATE INDEX "public_projects_rels_order_idx" ON "public_projects_rels" USING btree ("order");
  CREATE INDEX "public_projects_rels_parent_idx" ON "public_projects_rels" USING btree ("parent_id");
  CREATE INDEX "public_projects_rels_path_idx" ON "public_projects_rels" USING btree ("path");
  CREATE INDEX "public_projects_rels_team_id_idx" ON "public_projects_rels" USING btree ("team_id");
  CREATE INDEX "team_socials_order_idx" ON "team_socials" USING btree ("_order");
  CREATE INDEX "team_socials_parent_id_idx" ON "team_socials" USING btree ("_parent_id");
  CREATE INDEX "team_updated_at_idx" ON "team" USING btree ("updated_at");
  CREATE INDEX "team_created_at_idx" ON "team" USING btree ("created_at");
  CREATE INDEX "team_rels_order_idx" ON "team_rels" USING btree ("order");
  CREATE INDEX "team_rels_parent_idx" ON "team_rels" USING btree ("parent_id");
  CREATE INDEX "team_rels_path_idx" ON "team_rels" USING btree ("path");
  CREATE INDEX "team_rels_public_projects_id_idx" ON "team_rels" USING btree ("public_projects_id");
  CREATE INDEX "pages_faq_order_idx" ON "pages_faq" USING btree ("_order");
  CREATE INDEX "pages_faq_parent_id_idx" ON "pages_faq" USING btree ("_parent_id");
  CREATE INDEX "pages_path_steps_order_idx" ON "pages_path_steps" USING btree ("_order");
  CREATE INDEX "pages_path_steps_parent_id_idx" ON "pages_path_steps" USING btree ("_parent_id");
  CREATE INDEX "pages_hero_proof_items_order_idx" ON "pages_hero_proof_items" USING btree ("_order");
  CREATE INDEX "pages_hero_proof_items_parent_id_idx" ON "pages_hero_proof_items" USING btree ("_parent_id");
  CREATE INDEX "pages_intro_actions_order_idx" ON "pages_intro_actions" USING btree ("_order");
  CREATE INDEX "pages_intro_actions_parent_id_idx" ON "pages_intro_actions" USING btree ("_parent_id");
  CREATE INDEX "pages_trust_stats_order_idx" ON "pages_trust_stats" USING btree ("_order");
  CREATE INDEX "pages_trust_stats_parent_id_idx" ON "pages_trust_stats" USING btree ("_parent_id");
  CREATE INDEX "pages_participate_forms_fields_options_order_idx" ON "pages_participate_forms_fields_options" USING btree ("_order");
  CREATE INDEX "pages_participate_forms_fields_options_parent_id_idx" ON "pages_participate_forms_fields_options" USING btree ("_parent_id");
  CREATE INDEX "pages_participate_forms_fields_order_idx" ON "pages_participate_forms_fields" USING btree ("_order");
  CREATE INDEX "pages_participate_forms_fields_parent_id_idx" ON "pages_participate_forms_fields" USING btree ("_parent_id");
  CREATE INDEX "pages_participate_forms_order_idx" ON "pages_participate_forms" USING btree ("_order");
  CREATE INDEX "pages_participate_forms_parent_id_idx" ON "pages_participate_forms" USING btree ("_parent_id");
  CREATE INDEX "pages_privacy_sections_order_idx" ON "pages_privacy_sections" USING btree ("_order");
  CREATE INDEX "pages_privacy_sections_parent_id_idx" ON "pages_privacy_sections" USING btree ("_parent_id");
  CREATE INDEX "pages_updated_at_idx" ON "pages" USING btree ("updated_at");
  CREATE INDEX "pages_created_at_idx" ON "pages" USING btree ("created_at");
  CREATE INDEX "pages_texts_order_parent" ON "pages_texts" USING btree ("order","parent_id");
  CREATE INDEX "philosophy_values_order_idx" ON "philosophy_values" USING btree ("_order");
  CREATE INDEX "philosophy_values_parent_id_idx" ON "philosophy_values" USING btree ("_parent_id");
  CREATE INDEX "philosophy_principles_order_idx" ON "philosophy_principles" USING btree ("_order");
  CREATE INDEX "philosophy_principles_parent_id_idx" ON "philosophy_principles" USING btree ("_parent_id");
  CREATE INDEX "philosophy_teal_pillars_order_idx" ON "philosophy_teal_pillars" USING btree ("_order");
  CREATE INDEX "philosophy_teal_pillars_parent_id_idx" ON "philosophy_teal_pillars" USING btree ("_parent_id");
  CREATE INDEX "philosophy_roles_order_idx" ON "philosophy_roles" USING btree ("_order");
  CREATE INDEX "philosophy_roles_parent_id_idx" ON "philosophy_roles" USING btree ("_parent_id");
  CREATE INDEX "contact_socials_order_idx" ON "contact_socials" USING btree ("_order");
  CREATE INDEX "contact_socials_parent_id_idx" ON "contact_socials" USING btree ("_parent_id");
  CREATE INDEX "site_chrome_nav_order_idx" ON "site_chrome_nav" USING btree ("_order");
  CREATE INDEX "site_chrome_nav_parent_id_idx" ON "site_chrome_nav" USING btree ("_parent_id");
  CREATE INDEX "site_chrome_footer_columns_links_order_idx" ON "site_chrome_footer_columns_links" USING btree ("_order");
  CREATE INDEX "site_chrome_footer_columns_links_parent_id_idx" ON "site_chrome_footer_columns_links" USING btree ("_parent_id");
  CREATE INDEX "site_chrome_footer_columns_order_idx" ON "site_chrome_footer_columns" USING btree ("_order");
  CREATE INDEX "site_chrome_footer_columns_parent_id_idx" ON "site_chrome_footer_columns" USING btree ("_parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_public_projects_fk" FOREIGN KEY ("public_projects_id") REFERENCES "public"."public_projects"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_team_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_public_projects_id_idx" ON "payload_locked_documents_rels" USING btree ("public_projects_id");
  CREATE INDEX "payload_locked_documents_rels_team_id_idx" ON "payload_locked_documents_rels" USING btree ("team_id");
  CREATE INDEX "payload_locked_documents_rels_pages_id_idx" ON "payload_locked_documents_rels" USING btree ("pages_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "public_projects_metrics" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "public_projects" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "public_projects_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "public_projects_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "team_socials" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "team" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "team_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_faq" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_path_steps" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_hero_proof_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_intro_actions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_trust_stats" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_participate_forms_fields_options" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_participate_forms_fields" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_participate_forms" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_privacy_sections" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "philosophy_values" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "philosophy_principles" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "philosophy_teal_pillars" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "philosophy_roles" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "philosophy" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "contact_socials" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "contact" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_chrome_nav" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_chrome_footer_columns_links" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_chrome_footer_columns" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_chrome" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "public_projects_metrics" CASCADE;
  DROP TABLE "public_projects" CASCADE;
  DROP TABLE "public_projects_texts" CASCADE;
  DROP TABLE "public_projects_rels" CASCADE;
  DROP TABLE "team_socials" CASCADE;
  DROP TABLE "team" CASCADE;
  DROP TABLE "team_rels" CASCADE;
  DROP TABLE "pages_faq" CASCADE;
  DROP TABLE "pages_path_steps" CASCADE;
  DROP TABLE "pages_hero_proof_items" CASCADE;
  DROP TABLE "pages_intro_actions" CASCADE;
  DROP TABLE "pages_trust_stats" CASCADE;
  DROP TABLE "pages_participate_forms_fields_options" CASCADE;
  DROP TABLE "pages_participate_forms_fields" CASCADE;
  DROP TABLE "pages_participate_forms" CASCADE;
  DROP TABLE "pages_privacy_sections" CASCADE;
  DROP TABLE "pages" CASCADE;
  DROP TABLE "pages_texts" CASCADE;
  DROP TABLE "philosophy_values" CASCADE;
  DROP TABLE "philosophy_principles" CASCADE;
  DROP TABLE "philosophy_teal_pillars" CASCADE;
  DROP TABLE "philosophy_roles" CASCADE;
  DROP TABLE "philosophy" CASCADE;
  DROP TABLE "contact_socials" CASCADE;
  DROP TABLE "contact" CASCADE;
  DROP TABLE "site_chrome_nav" CASCADE;
  DROP TABLE "site_chrome_footer_columns_links" CASCADE;
  DROP TABLE "site_chrome_footer_columns" CASCADE;
  DROP TABLE "site_chrome" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_public_projects_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_team_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_pages_fk";
  
  DROP INDEX "payload_locked_documents_rels_public_projects_id_idx";
  DROP INDEX "payload_locked_documents_rels_team_id_idx";
  DROP INDEX "payload_locked_documents_rels_pages_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "public_projects_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "team_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "pages_id";
  DROP TYPE "public"."enum_public_projects_status";
  DROP TYPE "public"."enum_public_projects_maturity";
  DROP TYPE "public"."enum_public_projects_visibility";
  DROP TYPE "public"."enum_public_projects_locale";
  DROP TYPE "public"."enum_team_locale";
  DROP TYPE "public"."enum_pages_trust_stats_tone";
  DROP TYPE "public"."enum_pages_participate_forms_fields_type";
  DROP TYPE "public"."enum_pages_locale";
  DROP TYPE "public"."enum_philosophy_locale";
  DROP TYPE "public"."enum_contact_locale";
  DROP TYPE "public"."enum_site_chrome_locale";`)
}
