import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
await db.execute(sql`
 CREATE TYPE "public"."enum_public_projects_project_status" AS ENUM('active', 'launching', 'exploring', 'soon');
CREATE TYPE "public"."enum__public_projects_v_version_maturity" AS ENUM('rich', 'thin', 'soon');
CREATE TYPE "public"."enum__public_projects_v_version_visibility" AS ENUM('public', 'restricted');
CREATE TYPE "public"."enum__public_projects_v_version_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum__public_projects_v_version_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum_team_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum__team_v_version_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum__team_v_version_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum_pages_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum__pages_v_version_trust_stats_tone" AS ENUM('default', 'teal', 'empty');
CREATE TYPE "public"."enum__pages_v_version_participate_forms_fields_type" AS ENUM('text', 'email', 'tel', 'select', 'textarea');
CREATE TYPE "public"."enum__pages_v_version_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum__pages_v_version_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum_philosophy_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum__philosophy_v_version_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum__philosophy_v_version_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum_contact_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum__contact_v_version_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum__contact_v_version_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum_site_chrome_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum__site_chrome_v_version_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum__site_chrome_v_version_status" AS ENUM('draft', 'published');
CREATE TABLE "_public_projects_v_version_metrics" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar,
	"value" varchar,
	"_uuid" varchar
);

CREATE TABLE "_public_projects_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" varchar,
	"version_name" varchar,
	"version_tagline" varchar,
	"version_direction" varchar,
	"version_status" "enum_public_projects_project_status",
	"version_maturity" "enum__public_projects_v_version_maturity",
	"version_description" varchar,
	"version_disclaimer" varchar,
	"version_media_logo" varchar,
	"version_next_step_label" varchar,
	"version_next_step_href" varchar,
	"version_visibility" "enum__public_projects_v_version_visibility" DEFAULT 'public',
	"version_locale" "enum__public_projects_v_version_locale" DEFAULT 'ru',
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"version__status" "enum__public_projects_v_version_status" DEFAULT 'draft',
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean,
	"autosave" boolean
);

CREATE TABLE "_public_projects_v_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
);

CREATE TABLE "_public_projects_v_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"team_id" varchar
);

CREATE TABLE "_team_v_version_socials" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar,
	"_uuid" varchar
);

CREATE TABLE "_team_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" varchar,
	"version_name" varchar,
	"version_initials" varchar,
	"version_role" varchar,
	"version_bio" varchar,
	"version_photo" varchar,
	"version_locale" "enum__team_v_version_locale" DEFAULT 'ru',
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"version__status" "enum__team_v_version_status" DEFAULT 'draft',
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean,
	"autosave" boolean
);

CREATE TABLE "_team_v_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"public_projects_id" varchar
);

CREATE TABLE "_pages_v_version_faq" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"question" varchar,
	"answer" varchar,
	"_uuid" varchar
);

CREATE TABLE "_pages_v_version_path_steps" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar,
	"body" varchar,
	"_uuid" varchar
);

CREATE TABLE "_pages_v_version_hero_proof_items" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"icon" varchar,
	"title" varchar,
	"body" varchar,
	"_uuid" varchar
);

CREATE TABLE "_pages_v_version_intro_actions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar,
	"_uuid" varchar
);

CREATE TABLE "_pages_v_version_trust_stats" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"value" varchar,
	"label" varchar,
	"sub" varchar,
	"tone" "enum__pages_v_version_trust_stats_tone",
	"_uuid" varchar
);

CREATE TABLE "_pages_v_version_participate_forms_fields_options" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"value" varchar,
	"label" varchar,
	"_uuid" varchar
);

CREATE TABLE "_pages_v_version_participate_forms_fields" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar,
	"type" "enum__pages_v_version_participate_forms_fields_type",
	"label" varchar,
	"placeholder" varchar,
	"hint" varchar,
	"required" boolean,
	"full" boolean,
	"autocomplete" varchar,
	"validation_message" varchar,
	"placeholder_option" varchar,
	"_uuid" varchar
);

CREATE TABLE "_pages_v_version_participate_forms" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"_uuid" varchar,
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

CREATE TABLE "_pages_v_version_privacy_sections" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"_uuid" varchar,
	"heading" varchar
);

CREATE TABLE "_pages_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" varchar,
	"version_title" varchar,
	"version_body" varchar,
	"version_seo_title" varchar,
	"version_seo_description" varchar,
	"version_hero_eyebrow" varchar,
	"version_hero_sticker" varchar,
	"version_hero_title_lead" varchar,
	"version_hero_title_mark" varchar,
	"version_hero_title_trail" varchar,
	"version_hero_lead" varchar,
	"version_hero_primary_cta_label" varchar,
	"version_hero_primary_cta_href" varchar,
	"version_hero_secondary_cta_label" varchar,
	"version_hero_secondary_cta_href" varchar,
	"version_hero_proof_label" varchar,
	"version_what_is_eyebrow" varchar,
	"version_what_is_title" varchar,
	"version_showcase_eyebrow" varchar,
	"version_showcase_title" varchar,
	"version_showcase_lead" varchar,
	"version_showcase_all_link_label" varchar,
	"version_showcase_all_link_href" varchar,
	"version_intro_eyebrow" varchar,
	"version_intro_title" varchar,
	"version_intro_lead" varchar,
	"version_filters_label" varchar,
	"version_filters_all_label" varchar,
	"version_about_what_is_eyebrow" varchar,
	"version_about_what_is_title" varchar,
	"version_about_what_is_lead" varchar,
	"version_about_goal_eyebrow" varchar,
	"version_about_goal_title" varchar,
	"version_about_goal_lead" varchar,
	"version_about_values_eyebrow" varchar,
	"version_about_values_title" varchar,
	"version_about_values_lead" varchar,
	"version_about_principles_eyebrow" varchar,
	"version_about_principles_title" varchar,
	"version_about_principles_lead" varchar,
	"version_about_approach_eyebrow" varchar,
	"version_about_approach_title" varchar,
	"version_about_approach_lead" varchar,
	"version_about_roles_eyebrow" varchar,
	"version_about_roles_title" varchar,
	"version_about_roles_lead" varchar,
	"version_about_goal_kicker" varchar,
	"version_about_mission_kicker" varchar,
	"version_about_approach_note_title" varchar,
	"version_about_approach_note_body" varchar,
	"version_path_intro_eyebrow" varchar,
	"version_path_intro_title" varchar,
	"version_path_intro_lead" varchar,
	"version_trust_eyebrow" varchar,
	"version_trust_title" varchar,
	"version_trust_lead" varchar,
	"version_contour_eyebrow" varchar,
	"version_contour_title" varchar,
	"version_contour_public_kicker" varchar,
	"version_contour_public_title" varchar,
	"version_contour_internal_kicker" varchar,
	"version_contour_internal_title" varchar,
	"version_contour_boundary" varchar,
	"version_faq_intro_eyebrow" varchar,
	"version_faq_intro_title" varchar,
	"version_contacts_eyebrow" varchar,
	"version_contacts_title" varchar,
	"version_contacts_lead" varchar,
	"version_contacts_boundary_icon" varchar,
	"version_contacts_boundary_label" varchar,
	"version_contacts_boundary_value" varchar,
	"version_contacts_note" varchar,
	"version_team_eyebrow" varchar,
	"version_team_title" varchar,
	"version_team_lead" varchar,
	"version_participate_roles_slug" varchar,
	"version_participate_roles_eyebrow" varchar,
	"version_participate_roles_title" varchar,
	"version_participate_roles_lead" varchar,
	"version_participate_no_script_message" varchar,
	"version_participate_no_script_link_text" varchar,
	"version_participate_no_script_contacts_link_text" varchar,
	"version_privacy_draft_note_label" varchar,
	"version_privacy_draft_note_body" varchar,
	"version_privacy_operator_slug" varchar,
	"version_privacy_operator_heading" varchar,
	"version_privacy_consent_anchor" varchar,
	"version_privacy_consent_label" varchar,
	"version_cta_title" varchar,
	"version_cta_lead" varchar,
	"version_cta_primary_cta_label" varchar,
	"version_cta_primary_cta_href" varchar,
	"version_cta_secondary_cta_label" varchar,
	"version_cta_secondary_cta_href" varchar,
	"version_locale" "enum__pages_v_version_locale" DEFAULT 'ru',
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"version__status" "enum__pages_v_version_status" DEFAULT 'draft',
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean,
	"autosave" boolean
);

CREATE TABLE "_pages_v_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
);

CREATE TABLE "_philosophy_v_version_values" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar,
	"body" varchar,
	"icon" varchar,
	"_uuid" varchar
);

CREATE TABLE "_philosophy_v_version_principles" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar,
	"body" varchar,
	"_uuid" varchar
);

CREATE TABLE "_philosophy_v_version_teal_pillars" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar,
	"body" varchar,
	"icon" varchar,
	"_uuid" varchar
);

CREATE TABLE "_philosophy_v_version_roles" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar,
	"icon" varchar,
	"share" varchar,
	"extra" varchar,
	"body" varchar,
	"hot" boolean,
	"_uuid" varchar
);

CREATE TABLE "_philosophy_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_evolutionary_goal" varchar,
	"version_mission" varchar,
	"version_locale" "enum__philosophy_v_version_locale" DEFAULT 'ru',
	"version__status" "enum__philosophy_v_version_status" DEFAULT 'draft',
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean,
	"autosave" boolean
);

CREATE TABLE "_contact_v_version_socials" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar,
	"_uuid" varchar
);

CREATE TABLE "_contact_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_email" varchar,
	"version_phone" varchar,
	"version_legal_entity" varchar,
	"version_domain" varchar,
	"version_locale" "enum__contact_v_version_locale" DEFAULT 'ru',
	"version__status" "enum__contact_v_version_status" DEFAULT 'draft',
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean,
	"autosave" boolean
);

CREATE TABLE "_site_chrome_v_version_nav" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar,
	"_uuid" varchar
);

CREATE TABLE "_site_chrome_v_version_footer_columns_links" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar,
	"_uuid" varchar
);

CREATE TABLE "_site_chrome_v_version_footer_columns" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"heading" varchar,
	"_uuid" varchar
);

CREATE TABLE "_site_chrome_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_login_label" varchar,
	"version_login_href" varchar,
	"version_cta_label" varchar,
	"version_cta_href" varchar,
	"version_footer_tagline" varchar,
	"version_copyright" varchar,
	"version_locale" "enum__site_chrome_v_version_locale" DEFAULT 'ru',
	"version__status" "enum__site_chrome_v_version_status" DEFAULT 'draft',
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean,
	"autosave" boolean
);

ALTER TABLE "public_projects" ALTER COLUMN "status" SET DATA TYPE "public"."enum_public_projects_project_status" USING "status"::text::"public"."enum_public_projects_project_status";
DROP TYPE "public"."enum_public_projects_status";
CREATE TYPE "public"."enum_public_projects_status" AS ENUM('draft', 'published');
ALTER TABLE "public_projects" ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE "public_projects" ALTER COLUMN "tagline" DROP NOT NULL;
ALTER TABLE "public_projects" ALTER COLUMN "direction" DROP NOT NULL;
ALTER TABLE "public_projects" ALTER COLUMN "status" DROP NOT NULL;
ALTER TABLE "public_projects" ALTER COLUMN "maturity" DROP NOT NULL;
ALTER TABLE "public_projects" ALTER COLUMN "locale" DROP NOT NULL;
ALTER TABLE "team" ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE "team" ALTER COLUMN "locale" DROP NOT NULL;
ALTER TABLE "pages_participate_forms_fields" ALTER COLUMN "type" DROP NOT NULL;
ALTER TABLE "pages" ALTER COLUMN "title" DROP NOT NULL;
ALTER TABLE "pages" ALTER COLUMN "locale" DROP NOT NULL;
ALTER TABLE "philosophy" ALTER COLUMN "locale" DROP NOT NULL;
ALTER TABLE "contact" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "contact" ALTER COLUMN "locale" DROP NOT NULL;
ALTER TABLE "site_chrome" ALTER COLUMN "locale" DROP NOT NULL;
ALTER TABLE "public_projects" ADD COLUMN "_status" "enum_public_projects_status" DEFAULT 'draft';
ALTER TABLE "team" ADD COLUMN "_status" "enum_team_status" DEFAULT 'draft';
ALTER TABLE "pages" ADD COLUMN "_status" "enum_pages_status" DEFAULT 'draft';
ALTER TABLE "philosophy" ADD COLUMN "_status" "enum_philosophy_status" DEFAULT 'draft';
ALTER TABLE "contact" ADD COLUMN "_status" "enum_contact_status" DEFAULT 'draft';
ALTER TABLE "site_chrome" ADD COLUMN "_status" "enum_site_chrome_status" DEFAULT 'draft';
ALTER TABLE "_public_projects_v_version_metrics" ADD CONSTRAINT "_public_projects_v_version_metrics_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_public_projects_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_public_projects_v" ADD CONSTRAINT "_public_projects_v_parent_id_public_projects_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."public_projects"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "_public_projects_v_texts" ADD CONSTRAINT "_public_projects_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_public_projects_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_public_projects_v_rels" ADD CONSTRAINT "_public_projects_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_public_projects_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_public_projects_v_rels" ADD CONSTRAINT "_public_projects_v_rels_team_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_team_v_version_socials" ADD CONSTRAINT "_team_v_version_socials_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_team_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_team_v" ADD CONSTRAINT "_team_v_parent_id_team_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "_team_v_rels" ADD CONSTRAINT "_team_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_team_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_team_v_rels" ADD CONSTRAINT "_team_v_rels_public_projects_fk" FOREIGN KEY ("public_projects_id") REFERENCES "public"."public_projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_pages_v_version_faq" ADD CONSTRAINT "_pages_v_version_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_pages_v_version_path_steps" ADD CONSTRAINT "_pages_v_version_path_steps_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_pages_v_version_hero_proof_items" ADD CONSTRAINT "_pages_v_version_hero_proof_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_pages_v_version_intro_actions" ADD CONSTRAINT "_pages_v_version_intro_actions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_pages_v_version_trust_stats" ADD CONSTRAINT "_pages_v_version_trust_stats_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_pages_v_version_participate_forms_fields_options" ADD CONSTRAINT "_pages_v_version_participate_forms_fields_options_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v_version_participate_forms_fields"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_pages_v_version_participate_forms_fields" ADD CONSTRAINT "_pages_v_version_participate_forms_fields_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v_version_participate_forms"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_pages_v_version_participate_forms" ADD CONSTRAINT "_pages_v_version_participate_forms_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_pages_v_version_privacy_sections" ADD CONSTRAINT "_pages_v_version_privacy_sections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_pages_v" ADD CONSTRAINT "_pages_v_parent_id_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "_pages_v_texts" ADD CONSTRAINT "_pages_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_philosophy_v_version_values" ADD CONSTRAINT "_philosophy_v_version_values_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_philosophy_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_philosophy_v_version_principles" ADD CONSTRAINT "_philosophy_v_version_principles_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_philosophy_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_philosophy_v_version_teal_pillars" ADD CONSTRAINT "_philosophy_v_version_teal_pillars_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_philosophy_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_philosophy_v_version_roles" ADD CONSTRAINT "_philosophy_v_version_roles_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_philosophy_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_contact_v_version_socials" ADD CONSTRAINT "_contact_v_version_socials_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_contact_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_site_chrome_v_version_nav" ADD CONSTRAINT "_site_chrome_v_version_nav_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_site_chrome_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_site_chrome_v_version_footer_columns_links" ADD CONSTRAINT "_site_chrome_v_version_footer_columns_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_site_chrome_v_version_footer_columns"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_site_chrome_v_version_footer_columns" ADD CONSTRAINT "_site_chrome_v_version_footer_columns_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_site_chrome_v"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "_public_projects_v_version_metrics_order_idx" ON "_public_projects_v_version_metrics" USING btree ("_order");
CREATE INDEX "_public_projects_v_version_metrics_parent_id_idx" ON "_public_projects_v_version_metrics" USING btree ("_parent_id");
CREATE INDEX "_public_projects_v_parent_idx" ON "_public_projects_v" USING btree ("parent_id");
CREATE INDEX "_public_projects_v_version_version_updated_at_idx" ON "_public_projects_v" USING btree ("version_updated_at");
CREATE INDEX "_public_projects_v_version_version_created_at_idx" ON "_public_projects_v" USING btree ("version_created_at");
CREATE INDEX "_public_projects_v_version_version__status_idx" ON "_public_projects_v" USING btree ("version__status");
CREATE INDEX "_public_projects_v_created_at_idx" ON "_public_projects_v" USING btree ("created_at");
CREATE INDEX "_public_projects_v_updated_at_idx" ON "_public_projects_v" USING btree ("updated_at");
CREATE INDEX "_public_projects_v_latest_idx" ON "_public_projects_v" USING btree ("latest");
CREATE INDEX "_public_projects_v_autosave_idx" ON "_public_projects_v" USING btree ("autosave");
CREATE INDEX "_public_projects_v_texts_order_parent" ON "_public_projects_v_texts" USING btree ("order","parent_id");
CREATE INDEX "_public_projects_v_rels_order_idx" ON "_public_projects_v_rels" USING btree ("order");
CREATE INDEX "_public_projects_v_rels_parent_idx" ON "_public_projects_v_rels" USING btree ("parent_id");
CREATE INDEX "_public_projects_v_rels_path_idx" ON "_public_projects_v_rels" USING btree ("path");
CREATE INDEX "_public_projects_v_rels_team_id_idx" ON "_public_projects_v_rels" USING btree ("team_id");
CREATE INDEX "_team_v_version_socials_order_idx" ON "_team_v_version_socials" USING btree ("_order");
CREATE INDEX "_team_v_version_socials_parent_id_idx" ON "_team_v_version_socials" USING btree ("_parent_id");
CREATE INDEX "_team_v_parent_idx" ON "_team_v" USING btree ("parent_id");
CREATE INDEX "_team_v_version_version_updated_at_idx" ON "_team_v" USING btree ("version_updated_at");
CREATE INDEX "_team_v_version_version_created_at_idx" ON "_team_v" USING btree ("version_created_at");
CREATE INDEX "_team_v_version_version__status_idx" ON "_team_v" USING btree ("version__status");
CREATE INDEX "_team_v_created_at_idx" ON "_team_v" USING btree ("created_at");
CREATE INDEX "_team_v_updated_at_idx" ON "_team_v" USING btree ("updated_at");
CREATE INDEX "_team_v_latest_idx" ON "_team_v" USING btree ("latest");
CREATE INDEX "_team_v_autosave_idx" ON "_team_v" USING btree ("autosave");
CREATE INDEX "_team_v_rels_order_idx" ON "_team_v_rels" USING btree ("order");
CREATE INDEX "_team_v_rels_parent_idx" ON "_team_v_rels" USING btree ("parent_id");
CREATE INDEX "_team_v_rels_path_idx" ON "_team_v_rels" USING btree ("path");
CREATE INDEX "_team_v_rels_public_projects_id_idx" ON "_team_v_rels" USING btree ("public_projects_id");
CREATE INDEX "_pages_v_version_faq_order_idx" ON "_pages_v_version_faq" USING btree ("_order");
CREATE INDEX "_pages_v_version_faq_parent_id_idx" ON "_pages_v_version_faq" USING btree ("_parent_id");
CREATE INDEX "_pages_v_version_path_steps_order_idx" ON "_pages_v_version_path_steps" USING btree ("_order");
CREATE INDEX "_pages_v_version_path_steps_parent_id_idx" ON "_pages_v_version_path_steps" USING btree ("_parent_id");
CREATE INDEX "_pages_v_version_hero_proof_items_order_idx" ON "_pages_v_version_hero_proof_items" USING btree ("_order");
CREATE INDEX "_pages_v_version_hero_proof_items_parent_id_idx" ON "_pages_v_version_hero_proof_items" USING btree ("_parent_id");
CREATE INDEX "_pages_v_version_intro_actions_order_idx" ON "_pages_v_version_intro_actions" USING btree ("_order");
CREATE INDEX "_pages_v_version_intro_actions_parent_id_idx" ON "_pages_v_version_intro_actions" USING btree ("_parent_id");
CREATE INDEX "_pages_v_version_trust_stats_order_idx" ON "_pages_v_version_trust_stats" USING btree ("_order");
CREATE INDEX "_pages_v_version_trust_stats_parent_id_idx" ON "_pages_v_version_trust_stats" USING btree ("_parent_id");
CREATE INDEX "_pages_v_version_participate_forms_fields_options_order_idx" ON "_pages_v_version_participate_forms_fields_options" USING btree ("_order");
CREATE INDEX "_pages_v_version_participate_forms_fields_options_parent_id_idx" ON "_pages_v_version_participate_forms_fields_options" USING btree ("_parent_id");
CREATE INDEX "_pages_v_version_participate_forms_fields_order_idx" ON "_pages_v_version_participate_forms_fields" USING btree ("_order");
CREATE INDEX "_pages_v_version_participate_forms_fields_parent_id_idx" ON "_pages_v_version_participate_forms_fields" USING btree ("_parent_id");
CREATE INDEX "_pages_v_version_participate_forms_order_idx" ON "_pages_v_version_participate_forms" USING btree ("_order");
CREATE INDEX "_pages_v_version_participate_forms_parent_id_idx" ON "_pages_v_version_participate_forms" USING btree ("_parent_id");
CREATE INDEX "_pages_v_version_privacy_sections_order_idx" ON "_pages_v_version_privacy_sections" USING btree ("_order");
CREATE INDEX "_pages_v_version_privacy_sections_parent_id_idx" ON "_pages_v_version_privacy_sections" USING btree ("_parent_id");
CREATE INDEX "_pages_v_parent_idx" ON "_pages_v" USING btree ("parent_id");
CREATE INDEX "_pages_v_version_version_updated_at_idx" ON "_pages_v" USING btree ("version_updated_at");
CREATE INDEX "_pages_v_version_version_created_at_idx" ON "_pages_v" USING btree ("version_created_at");
CREATE INDEX "_pages_v_version_version__status_idx" ON "_pages_v" USING btree ("version__status");
CREATE INDEX "_pages_v_created_at_idx" ON "_pages_v" USING btree ("created_at");
CREATE INDEX "_pages_v_updated_at_idx" ON "_pages_v" USING btree ("updated_at");
CREATE INDEX "_pages_v_latest_idx" ON "_pages_v" USING btree ("latest");
CREATE INDEX "_pages_v_autosave_idx" ON "_pages_v" USING btree ("autosave");
CREATE INDEX "_pages_v_texts_order_parent" ON "_pages_v_texts" USING btree ("order","parent_id");
CREATE INDEX "_philosophy_v_version_values_order_idx" ON "_philosophy_v_version_values" USING btree ("_order");
CREATE INDEX "_philosophy_v_version_values_parent_id_idx" ON "_philosophy_v_version_values" USING btree ("_parent_id");
CREATE INDEX "_philosophy_v_version_principles_order_idx" ON "_philosophy_v_version_principles" USING btree ("_order");
CREATE INDEX "_philosophy_v_version_principles_parent_id_idx" ON "_philosophy_v_version_principles" USING btree ("_parent_id");
CREATE INDEX "_philosophy_v_version_teal_pillars_order_idx" ON "_philosophy_v_version_teal_pillars" USING btree ("_order");
CREATE INDEX "_philosophy_v_version_teal_pillars_parent_id_idx" ON "_philosophy_v_version_teal_pillars" USING btree ("_parent_id");
CREATE INDEX "_philosophy_v_version_roles_order_idx" ON "_philosophy_v_version_roles" USING btree ("_order");
CREATE INDEX "_philosophy_v_version_roles_parent_id_idx" ON "_philosophy_v_version_roles" USING btree ("_parent_id");
CREATE INDEX "_philosophy_v_version_version__status_idx" ON "_philosophy_v" USING btree ("version__status");
CREATE INDEX "_philosophy_v_created_at_idx" ON "_philosophy_v" USING btree ("created_at");
CREATE INDEX "_philosophy_v_updated_at_idx" ON "_philosophy_v" USING btree ("updated_at");
CREATE INDEX "_philosophy_v_latest_idx" ON "_philosophy_v" USING btree ("latest");
CREATE INDEX "_philosophy_v_autosave_idx" ON "_philosophy_v" USING btree ("autosave");
CREATE INDEX "_contact_v_version_socials_order_idx" ON "_contact_v_version_socials" USING btree ("_order");
CREATE INDEX "_contact_v_version_socials_parent_id_idx" ON "_contact_v_version_socials" USING btree ("_parent_id");
CREATE INDEX "_contact_v_version_version__status_idx" ON "_contact_v" USING btree ("version__status");
CREATE INDEX "_contact_v_created_at_idx" ON "_contact_v" USING btree ("created_at");
CREATE INDEX "_contact_v_updated_at_idx" ON "_contact_v" USING btree ("updated_at");
CREATE INDEX "_contact_v_latest_idx" ON "_contact_v" USING btree ("latest");
CREATE INDEX "_contact_v_autosave_idx" ON "_contact_v" USING btree ("autosave");
CREATE INDEX "_site_chrome_v_version_nav_order_idx" ON "_site_chrome_v_version_nav" USING btree ("_order");
CREATE INDEX "_site_chrome_v_version_nav_parent_id_idx" ON "_site_chrome_v_version_nav" USING btree ("_parent_id");
CREATE INDEX "_site_chrome_v_version_footer_columns_links_order_idx" ON "_site_chrome_v_version_footer_columns_links" USING btree ("_order");
CREATE INDEX "_site_chrome_v_version_footer_columns_links_parent_id_idx" ON "_site_chrome_v_version_footer_columns_links" USING btree ("_parent_id");
CREATE INDEX "_site_chrome_v_version_footer_columns_order_idx" ON "_site_chrome_v_version_footer_columns" USING btree ("_order");
CREATE INDEX "_site_chrome_v_version_footer_columns_parent_id_idx" ON "_site_chrome_v_version_footer_columns" USING btree ("_parent_id");
CREATE INDEX "_site_chrome_v_version_version__status_idx" ON "_site_chrome_v" USING btree ("version__status");
CREATE INDEX "_site_chrome_v_created_at_idx" ON "_site_chrome_v" USING btree ("created_at");
CREATE INDEX "_site_chrome_v_updated_at_idx" ON "_site_chrome_v" USING btree ("updated_at");
CREATE INDEX "_site_chrome_v_latest_idx" ON "_site_chrome_v" USING btree ("latest");
CREATE INDEX "_site_chrome_v_autosave_idx" ON "_site_chrome_v" USING btree ("autosave");
CREATE INDEX "public_projects__status_idx" ON "public_projects" USING btree ("_status");
CREATE INDEX "team__status_idx" ON "team" USING btree ("_status");
CREATE INDEX "pages__status_idx" ON "pages" USING btree ("_status");
CREATE INDEX "philosophy__status_idx" ON "philosophy" USING btree ("_status");
CREATE INDEX "contact__status_idx" ON "contact" USING btree ("_status");
CREATE INDEX "site_chrome__status_idx" ON "site_chrome" USING btree ("_status");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
await db.execute(sql`
 ALTER TABLE "_public_projects_v_version_metrics" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_public_projects_v" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_public_projects_v_texts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_public_projects_v_rels" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_team_v_version_socials" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_team_v" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_team_v_rels" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_pages_v_version_faq" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_pages_v_version_path_steps" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_pages_v_version_hero_proof_items" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_pages_v_version_intro_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_pages_v_version_trust_stats" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_pages_v_version_participate_forms_fields_options" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_pages_v_version_participate_forms_fields" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_pages_v_version_participate_forms" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_pages_v_version_privacy_sections" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_pages_v" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_pages_v_texts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_philosophy_v_version_values" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_philosophy_v_version_principles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_philosophy_v_version_teal_pillars" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_philosophy_v_version_roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_philosophy_v" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_contact_v_version_socials" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_contact_v" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_site_chrome_v_version_nav" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_site_chrome_v_version_footer_columns_links" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_site_chrome_v_version_footer_columns" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_site_chrome_v" DISABLE ROW LEVEL SECURITY;
DROP TABLE "_public_projects_v_version_metrics" CASCADE;
DROP TABLE "_public_projects_v" CASCADE;
DROP TABLE "_public_projects_v_texts" CASCADE;
DROP TABLE "_public_projects_v_rels" CASCADE;
DROP TABLE "_team_v_version_socials" CASCADE;
DROP TABLE "_team_v" CASCADE;
DROP TABLE "_team_v_rels" CASCADE;
DROP TABLE "_pages_v_version_faq" CASCADE;
DROP TABLE "_pages_v_version_path_steps" CASCADE;
DROP TABLE "_pages_v_version_hero_proof_items" CASCADE;
DROP TABLE "_pages_v_version_intro_actions" CASCADE;
DROP TABLE "_pages_v_version_trust_stats" CASCADE;
DROP TABLE "_pages_v_version_participate_forms_fields_options" CASCADE;
DROP TABLE "_pages_v_version_participate_forms_fields" CASCADE;
DROP TABLE "_pages_v_version_participate_forms" CASCADE;
DROP TABLE "_pages_v_version_privacy_sections" CASCADE;
DROP TABLE "_pages_v" CASCADE;
DROP TABLE "_pages_v_texts" CASCADE;
DROP TABLE "_philosophy_v_version_values" CASCADE;
DROP TABLE "_philosophy_v_version_principles" CASCADE;
DROP TABLE "_philosophy_v_version_teal_pillars" CASCADE;
DROP TABLE "_philosophy_v_version_roles" CASCADE;
DROP TABLE "_philosophy_v" CASCADE;
DROP TABLE "_contact_v_version_socials" CASCADE;
DROP TABLE "_contact_v" CASCADE;
DROP TABLE "_site_chrome_v_version_nav" CASCADE;
DROP TABLE "_site_chrome_v_version_footer_columns_links" CASCADE;
DROP TABLE "_site_chrome_v_version_footer_columns" CASCADE;
DROP TABLE "_site_chrome_v" CASCADE;
DROP INDEX "public_projects__status_idx";
DROP INDEX "team__status_idx";
DROP INDEX "pages__status_idx";
DROP INDEX "philosophy__status_idx";
DROP INDEX "contact__status_idx";
DROP INDEX "site_chrome__status_idx";
ALTER TABLE "public_projects" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "public_projects" ALTER COLUMN "tagline" SET NOT NULL;
ALTER TABLE "public_projects" ALTER COLUMN "direction" SET NOT NULL;
ALTER TABLE "public_projects" ALTER COLUMN "maturity" SET NOT NULL;
ALTER TABLE "public_projects" ALTER COLUMN "locale" SET NOT NULL;
ALTER TABLE "team" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "team" ALTER COLUMN "locale" SET NOT NULL;
ALTER TABLE "pages_participate_forms_fields" ALTER COLUMN "type" SET NOT NULL;
ALTER TABLE "pages" ALTER COLUMN "title" SET NOT NULL;
ALTER TABLE "pages" ALTER COLUMN "locale" SET NOT NULL;
ALTER TABLE "philosophy" ALTER COLUMN "locale" SET NOT NULL;
ALTER TABLE "contact" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "contact" ALTER COLUMN "locale" SET NOT NULL;
ALTER TABLE "site_chrome" ALTER COLUMN "locale" SET NOT NULL;
ALTER TABLE "public_projects" DROP COLUMN "_status";
ALTER TABLE "team" DROP COLUMN "_status";
ALTER TABLE "pages" DROP COLUMN "_status";
ALTER TABLE "philosophy" DROP COLUMN "_status";
ALTER TABLE "contact" DROP COLUMN "_status";
ALTER TABLE "site_chrome" DROP COLUMN "_status";
DROP TYPE "public"."enum_public_projects_status";
CREATE TYPE "public"."enum_public_projects_status" AS ENUM('active', 'launching', 'exploring', 'soon');
ALTER TABLE "public_projects" ALTER COLUMN "status" SET DATA TYPE "public"."enum_public_projects_status" USING "status"::text::"public"."enum_public_projects_status";
ALTER TABLE "public_projects" ALTER COLUMN "status" SET NOT NULL;
DROP TYPE "public"."enum_public_projects_project_status";
DROP TYPE "public"."enum__public_projects_v_version_maturity";
DROP TYPE "public"."enum__public_projects_v_version_visibility";
DROP TYPE "public"."enum__public_projects_v_version_locale";
DROP TYPE "public"."enum__public_projects_v_version_status";
DROP TYPE "public"."enum_team_status";
DROP TYPE "public"."enum__team_v_version_locale";
DROP TYPE "public"."enum__team_v_version_status";
DROP TYPE "public"."enum_pages_status";
DROP TYPE "public"."enum__pages_v_version_trust_stats_tone";
DROP TYPE "public"."enum__pages_v_version_participate_forms_fields_type";
DROP TYPE "public"."enum__pages_v_version_locale";
DROP TYPE "public"."enum__pages_v_version_status";
DROP TYPE "public"."enum_philosophy_status";
DROP TYPE "public"."enum__philosophy_v_version_locale";
DROP TYPE "public"."enum__philosophy_v_version_status";
DROP TYPE "public"."enum_contact_status";
DROP TYPE "public"."enum__contact_v_version_locale";
DROP TYPE "public"."enum__contact_v_version_status";
DROP TYPE "public"."enum_site_chrome_status";
DROP TYPE "public"."enum__site_chrome_v_version_locale";
DROP TYPE "public"."enum__site_chrome_v_version_status";`)
}
