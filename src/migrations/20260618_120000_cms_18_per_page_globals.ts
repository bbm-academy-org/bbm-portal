import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
-- #18: split monolithic 'pages' collection into 6 per-page globals.
-- (1) create the 6 globals + their _v version tables (drafts).
CREATE TYPE "public"."enum_page_home_trust_stats_tone" AS ENUM('default', 'teal', 'empty');
CREATE TYPE "public"."enum_page_home_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum_page_home_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum__page_home_v_version_trust_stats_tone" AS ENUM('default', 'teal', 'empty');
CREATE TYPE "public"."enum__page_home_v_version_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum__page_home_v_version_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum_page_about_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum_page_about_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum__page_about_v_version_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum__page_about_v_version_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum_page_contacts_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum_page_contacts_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum__page_contacts_v_version_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum__page_contacts_v_version_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum_page_participate_participate_forms_fields_type" AS ENUM('text', 'email', 'tel', 'select', 'textarea');
CREATE TYPE "public"."enum_page_participate_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum_page_participate_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum__page_participate_v_version_participate_forms_fields_type" AS ENUM('text', 'email', 'tel', 'select', 'textarea');
CREATE TYPE "public"."enum__page_participate_v_version_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum__page_participate_v_version_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum_page_privacy_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum_page_privacy_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum__page_privacy_v_version_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum__page_privacy_v_version_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum_page_projects_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum_page_projects_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum__page_projects_v_version_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum__page_projects_v_version_status" AS ENUM('draft', 'published');
CREATE TABLE "page_home_hero_proof_items" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"icon" varchar,
	"title" varchar,
	"body" varchar
);

CREATE TABLE "page_home_trust_stats" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"value" varchar,
	"label" varchar,
	"sub" varchar,
	"tone" "enum_page_home_trust_stats_tone"
);

CREATE TABLE "page_home_faq" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"question" varchar,
	"answer" varchar
);

CREATE TABLE "page_home_path_steps" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"title" varchar,
	"body" varchar
);

CREATE TABLE "page_home" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar,
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
	"cta_title" varchar,
	"cta_lead" varchar,
	"cta_primary_cta_label" varchar,
	"cta_primary_cta_href" varchar,
	"cta_secondary_cta_label" varchar,
	"cta_secondary_cta_href" varchar,
	"locale" "enum_page_home_locale" DEFAULT 'ru',
	"_status" "enum_page_home_status" DEFAULT 'draft',
	"updated_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone
);

CREATE TABLE "page_home_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
);

CREATE TABLE "_page_home_v_version_hero_proof_items" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"icon" varchar,
	"title" varchar,
	"body" varchar,
	"_uuid" varchar
);

CREATE TABLE "_page_home_v_version_trust_stats" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"value" varchar,
	"label" varchar,
	"sub" varchar,
	"tone" "enum__page_home_v_version_trust_stats_tone",
	"_uuid" varchar
);

CREATE TABLE "_page_home_v_version_faq" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"question" varchar,
	"answer" varchar,
	"_uuid" varchar
);

CREATE TABLE "_page_home_v_version_path_steps" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar,
	"body" varchar,
	"_uuid" varchar
);

CREATE TABLE "_page_home_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_title" varchar,
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
	"version_cta_title" varchar,
	"version_cta_lead" varchar,
	"version_cta_primary_cta_label" varchar,
	"version_cta_primary_cta_href" varchar,
	"version_cta_secondary_cta_label" varchar,
	"version_cta_secondary_cta_href" varchar,
	"version_locale" "enum__page_home_v_version_locale" DEFAULT 'ru',
	"version__status" "enum__page_home_v_version_status" DEFAULT 'draft',
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean,
	"autosave" boolean
);

CREATE TABLE "_page_home_v_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
);

CREATE TABLE "page_about_intro_actions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar
);

CREATE TABLE "page_about" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar,
	"seo_title" varchar,
	"seo_description" varchar,
	"intro_eyebrow" varchar,
	"intro_title" varchar,
	"intro_lead" varchar,
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
	"cta_title" varchar,
	"cta_lead" varchar,
	"cta_primary_cta_label" varchar,
	"cta_primary_cta_href" varchar,
	"cta_secondary_cta_label" varchar,
	"cta_secondary_cta_href" varchar,
	"locale" "enum_page_about_locale" DEFAULT 'ru',
	"_status" "enum_page_about_status" DEFAULT 'draft',
	"updated_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone
);

CREATE TABLE "page_about_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
);

CREATE TABLE "_page_about_v_version_intro_actions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar,
	"_uuid" varchar
);

CREATE TABLE "_page_about_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_title" varchar,
	"version_seo_title" varchar,
	"version_seo_description" varchar,
	"version_intro_eyebrow" varchar,
	"version_intro_title" varchar,
	"version_intro_lead" varchar,
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
	"version_cta_title" varchar,
	"version_cta_lead" varchar,
	"version_cta_primary_cta_label" varchar,
	"version_cta_primary_cta_href" varchar,
	"version_cta_secondary_cta_label" varchar,
	"version_cta_secondary_cta_href" varchar,
	"version_locale" "enum__page_about_v_version_locale" DEFAULT 'ru',
	"version__status" "enum__page_about_v_version_status" DEFAULT 'draft',
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean,
	"autosave" boolean
);

CREATE TABLE "_page_about_v_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
);

CREATE TABLE "page_contacts_intro_actions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar
);

CREATE TABLE "page_contacts_faq" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"question" varchar,
	"answer" varchar
);

CREATE TABLE "page_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar,
	"seo_title" varchar,
	"seo_description" varchar,
	"intro_eyebrow" varchar,
	"intro_title" varchar,
	"intro_lead" varchar,
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
	"faq_intro_eyebrow" varchar,
	"faq_intro_title" varchar,
	"cta_title" varchar,
	"cta_lead" varchar,
	"cta_primary_cta_label" varchar,
	"cta_primary_cta_href" varchar,
	"cta_secondary_cta_label" varchar,
	"cta_secondary_cta_href" varchar,
	"locale" "enum_page_contacts_locale" DEFAULT 'ru',
	"_status" "enum_page_contacts_status" DEFAULT 'draft',
	"updated_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone
);

CREATE TABLE "_page_contacts_v_version_intro_actions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar,
	"_uuid" varchar
);

CREATE TABLE "_page_contacts_v_version_faq" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"question" varchar,
	"answer" varchar,
	"_uuid" varchar
);

CREATE TABLE "_page_contacts_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_title" varchar,
	"version_seo_title" varchar,
	"version_seo_description" varchar,
	"version_intro_eyebrow" varchar,
	"version_intro_title" varchar,
	"version_intro_lead" varchar,
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
	"version_faq_intro_eyebrow" varchar,
	"version_faq_intro_title" varchar,
	"version_cta_title" varchar,
	"version_cta_lead" varchar,
	"version_cta_primary_cta_label" varchar,
	"version_cta_primary_cta_href" varchar,
	"version_cta_secondary_cta_label" varchar,
	"version_cta_secondary_cta_href" varchar,
	"version_locale" "enum__page_contacts_v_version_locale" DEFAULT 'ru',
	"version__status" "enum__page_contacts_v_version_status" DEFAULT 'draft',
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean,
	"autosave" boolean
);

CREATE TABLE "page_participate_intro_actions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar
);

CREATE TABLE "page_participate_participate_forms_fields_options" (
	"_order" integer NOT NULL,
	"_parent_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"value" varchar,
	"label" varchar
);

CREATE TABLE "page_participate_participate_forms_fields" (
	"_order" integer NOT NULL,
	"_parent_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"name" varchar,
	"type" "enum_page_participate_participate_forms_fields_type",
	"label" varchar,
	"placeholder" varchar,
	"hint" varchar,
	"required" boolean,
	"full" boolean,
	"autocomplete" varchar,
	"validation_message" varchar,
	"placeholder_option" varchar
);

CREATE TABLE "page_participate_participate_forms" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
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

CREATE TABLE "page_participate" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar,
	"seo_title" varchar,
	"seo_description" varchar,
	"intro_eyebrow" varchar,
	"intro_title" varchar,
	"intro_lead" varchar,
	"participate_roles_slug" varchar,
	"participate_roles_eyebrow" varchar,
	"participate_roles_title" varchar,
	"participate_roles_lead" varchar,
	"participate_no_script_message" varchar,
	"participate_no_script_link_text" varchar,
	"participate_no_script_contacts_link_text" varchar,
	"cta_title" varchar,
	"cta_lead" varchar,
	"cta_primary_cta_label" varchar,
	"cta_primary_cta_href" varchar,
	"cta_secondary_cta_label" varchar,
	"cta_secondary_cta_href" varchar,
	"locale" "enum_page_participate_locale" DEFAULT 'ru',
	"_status" "enum_page_participate_status" DEFAULT 'draft',
	"updated_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone
);

CREATE TABLE "_page_participate_v_version_intro_actions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar,
	"_uuid" varchar
);

CREATE TABLE "_page_participate_v_version_participate_forms_fields_options" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"value" varchar,
	"label" varchar,
	"_uuid" varchar
);

CREATE TABLE "_page_participate_v_version_participate_forms_fields" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar,
	"type" "enum__page_participate_v_version_participate_forms_fields_type",
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

CREATE TABLE "_page_participate_v_version_participate_forms" (
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

CREATE TABLE "_page_participate_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_title" varchar,
	"version_seo_title" varchar,
	"version_seo_description" varchar,
	"version_intro_eyebrow" varchar,
	"version_intro_title" varchar,
	"version_intro_lead" varchar,
	"version_participate_roles_slug" varchar,
	"version_participate_roles_eyebrow" varchar,
	"version_participate_roles_title" varchar,
	"version_participate_roles_lead" varchar,
	"version_participate_no_script_message" varchar,
	"version_participate_no_script_link_text" varchar,
	"version_participate_no_script_contacts_link_text" varchar,
	"version_cta_title" varchar,
	"version_cta_lead" varchar,
	"version_cta_primary_cta_label" varchar,
	"version_cta_primary_cta_href" varchar,
	"version_cta_secondary_cta_label" varchar,
	"version_cta_secondary_cta_href" varchar,
	"version_locale" "enum__page_participate_v_version_locale" DEFAULT 'ru',
	"version__status" "enum__page_participate_v_version_status" DEFAULT 'draft',
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean,
	"autosave" boolean
);

CREATE TABLE "page_privacy_intro_actions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar
);

CREATE TABLE "page_privacy_privacy_sections" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"heading" varchar
);

CREATE TABLE "page_privacy" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar,
	"seo_title" varchar,
	"seo_description" varchar,
	"intro_eyebrow" varchar,
	"intro_title" varchar,
	"intro_lead" varchar,
	"privacy_draft_note_label" varchar,
	"privacy_draft_note_body" varchar,
	"privacy_operator_slug" varchar,
	"privacy_operator_heading" varchar,
	"privacy_consent_anchor" varchar,
	"privacy_consent_label" varchar,
	"locale" "enum_page_privacy_locale" DEFAULT 'ru',
	"_status" "enum_page_privacy_status" DEFAULT 'draft',
	"updated_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone
);

CREATE TABLE "page_privacy_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
);

CREATE TABLE "_page_privacy_v_version_intro_actions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar,
	"_uuid" varchar
);

CREATE TABLE "_page_privacy_v_version_privacy_sections" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"_uuid" varchar,
	"heading" varchar
);

CREATE TABLE "_page_privacy_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_title" varchar,
	"version_seo_title" varchar,
	"version_seo_description" varchar,
	"version_intro_eyebrow" varchar,
	"version_intro_title" varchar,
	"version_intro_lead" varchar,
	"version_privacy_draft_note_label" varchar,
	"version_privacy_draft_note_body" varchar,
	"version_privacy_operator_slug" varchar,
	"version_privacy_operator_heading" varchar,
	"version_privacy_consent_anchor" varchar,
	"version_privacy_consent_label" varchar,
	"version_locale" "enum__page_privacy_v_version_locale" DEFAULT 'ru',
	"version__status" "enum__page_privacy_v_version_status" DEFAULT 'draft',
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean,
	"autosave" boolean
);

CREATE TABLE "_page_privacy_v_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
);

CREATE TABLE "page_projects_intro_actions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar
);

CREATE TABLE "page_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar,
	"seo_title" varchar,
	"seo_description" varchar,
	"intro_eyebrow" varchar,
	"intro_title" varchar,
	"intro_lead" varchar,
	"filters_label" varchar,
	"filters_all_label" varchar,
	"locale" "enum_page_projects_locale" DEFAULT 'ru',
	"_status" "enum_page_projects_status" DEFAULT 'draft',
	"updated_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone
);

CREATE TABLE "_page_projects_v_version_intro_actions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar,
	"href" varchar,
	"_uuid" varchar
);

CREATE TABLE "_page_projects_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_title" varchar,
	"version_seo_title" varchar,
	"version_seo_description" varchar,
	"version_intro_eyebrow" varchar,
	"version_intro_title" varchar,
	"version_intro_lead" varchar,
	"version_filters_label" varchar,
	"version_filters_all_label" varchar,
	"version_locale" "enum__page_projects_v_version_locale" DEFAULT 'ru',
	"version__status" "enum__page_projects_v_version_status" DEFAULT 'draft',
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean,
	"autosave" boolean
);

ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_pages_fk";

DROP INDEX "payload_locked_documents_rels_pages_id_idx";
ALTER TABLE "page_home_hero_proof_items" ADD CONSTRAINT "page_home_hero_proof_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_home"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_home_trust_stats" ADD CONSTRAINT "page_home_trust_stats_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_home"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_home_faq" ADD CONSTRAINT "page_home_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_home"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_home_path_steps" ADD CONSTRAINT "page_home_path_steps_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_home"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_home_texts" ADD CONSTRAINT "page_home_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."page_home"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_home_v_version_hero_proof_items" ADD CONSTRAINT "_page_home_v_version_hero_proof_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_home_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_home_v_version_trust_stats" ADD CONSTRAINT "_page_home_v_version_trust_stats_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_home_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_home_v_version_faq" ADD CONSTRAINT "_page_home_v_version_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_home_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_home_v_version_path_steps" ADD CONSTRAINT "_page_home_v_version_path_steps_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_home_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_home_v_texts" ADD CONSTRAINT "_page_home_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_page_home_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_about_intro_actions" ADD CONSTRAINT "page_about_intro_actions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_about"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_about_texts" ADD CONSTRAINT "page_about_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."page_about"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_about_v_version_intro_actions" ADD CONSTRAINT "_page_about_v_version_intro_actions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_about_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_about_v_texts" ADD CONSTRAINT "_page_about_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_page_about_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_contacts_intro_actions" ADD CONSTRAINT "page_contacts_intro_actions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_contacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_contacts_faq" ADD CONSTRAINT "page_contacts_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_contacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_contacts_v_version_intro_actions" ADD CONSTRAINT "_page_contacts_v_version_intro_actions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_contacts_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_contacts_v_version_faq" ADD CONSTRAINT "_page_contacts_v_version_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_contacts_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_participate_intro_actions" ADD CONSTRAINT "page_participate_intro_actions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_participate"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_participate_participate_forms_fields_options" ADD CONSTRAINT "page_participate_participate_forms_fields_options_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_participate_participate_forms_fields"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_participate_participate_forms_fields" ADD CONSTRAINT "page_participate_participate_forms_fields_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_participate_participate_forms"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_participate_participate_forms" ADD CONSTRAINT "page_participate_participate_forms_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_participate"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_participate_v_version_intro_actions" ADD CONSTRAINT "_page_participate_v_version_intro_actions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_participate_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_participate_v_version_participate_forms_fields_options" ADD CONSTRAINT "_page_participate_v_version_participate_forms_fields_options_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_participate_v_version_participate_forms_fields"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_participate_v_version_participate_forms_fields" ADD CONSTRAINT "_page_participate_v_version_participate_forms_fields_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_participate_v_version_participate_forms"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_participate_v_version_participate_forms" ADD CONSTRAINT "_page_participate_v_version_participate_forms_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_participate_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_privacy_intro_actions" ADD CONSTRAINT "page_privacy_intro_actions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_privacy"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_privacy_privacy_sections" ADD CONSTRAINT "page_privacy_privacy_sections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_privacy"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_privacy_texts" ADD CONSTRAINT "page_privacy_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."page_privacy"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_privacy_v_version_intro_actions" ADD CONSTRAINT "_page_privacy_v_version_intro_actions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_privacy_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_privacy_v_version_privacy_sections" ADD CONSTRAINT "_page_privacy_v_version_privacy_sections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_privacy_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_privacy_v_texts" ADD CONSTRAINT "_page_privacy_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_page_privacy_v"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_projects_intro_actions" ADD CONSTRAINT "page_projects_intro_actions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "_page_projects_v_version_intro_actions" ADD CONSTRAINT "_page_projects_v_version_intro_actions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_page_projects_v"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "page_home_hero_proof_items_order_idx" ON "page_home_hero_proof_items" USING btree ("_order");
CREATE INDEX "page_home_hero_proof_items_parent_id_idx" ON "page_home_hero_proof_items" USING btree ("_parent_id");
CREATE INDEX "page_home_trust_stats_order_idx" ON "page_home_trust_stats" USING btree ("_order");
CREATE INDEX "page_home_trust_stats_parent_id_idx" ON "page_home_trust_stats" USING btree ("_parent_id");
CREATE INDEX "page_home_faq_order_idx" ON "page_home_faq" USING btree ("_order");
CREATE INDEX "page_home_faq_parent_id_idx" ON "page_home_faq" USING btree ("_parent_id");
CREATE INDEX "page_home_path_steps_order_idx" ON "page_home_path_steps" USING btree ("_order");
CREATE INDEX "page_home_path_steps_parent_id_idx" ON "page_home_path_steps" USING btree ("_parent_id");
CREATE INDEX "page_home__status_idx" ON "page_home" USING btree ("_status");
CREATE INDEX "page_home_texts_order_parent" ON "page_home_texts" USING btree ("order","parent_id");
CREATE INDEX "_page_home_v_version_hero_proof_items_order_idx" ON "_page_home_v_version_hero_proof_items" USING btree ("_order");
CREATE INDEX "_page_home_v_version_hero_proof_items_parent_id_idx" ON "_page_home_v_version_hero_proof_items" USING btree ("_parent_id");
CREATE INDEX "_page_home_v_version_trust_stats_order_idx" ON "_page_home_v_version_trust_stats" USING btree ("_order");
CREATE INDEX "_page_home_v_version_trust_stats_parent_id_idx" ON "_page_home_v_version_trust_stats" USING btree ("_parent_id");
CREATE INDEX "_page_home_v_version_faq_order_idx" ON "_page_home_v_version_faq" USING btree ("_order");
CREATE INDEX "_page_home_v_version_faq_parent_id_idx" ON "_page_home_v_version_faq" USING btree ("_parent_id");
CREATE INDEX "_page_home_v_version_path_steps_order_idx" ON "_page_home_v_version_path_steps" USING btree ("_order");
CREATE INDEX "_page_home_v_version_path_steps_parent_id_idx" ON "_page_home_v_version_path_steps" USING btree ("_parent_id");
CREATE INDEX "_page_home_v_version_version__status_idx" ON "_page_home_v" USING btree ("version__status");
CREATE INDEX "_page_home_v_created_at_idx" ON "_page_home_v" USING btree ("created_at");
CREATE INDEX "_page_home_v_updated_at_idx" ON "_page_home_v" USING btree ("updated_at");
CREATE INDEX "_page_home_v_latest_idx" ON "_page_home_v" USING btree ("latest");
CREATE INDEX "_page_home_v_autosave_idx" ON "_page_home_v" USING btree ("autosave");
CREATE INDEX "_page_home_v_texts_order_parent" ON "_page_home_v_texts" USING btree ("order","parent_id");
CREATE INDEX "page_about_intro_actions_order_idx" ON "page_about_intro_actions" USING btree ("_order");
CREATE INDEX "page_about_intro_actions_parent_id_idx" ON "page_about_intro_actions" USING btree ("_parent_id");
CREATE INDEX "page_about__status_idx" ON "page_about" USING btree ("_status");
CREATE INDEX "page_about_texts_order_parent" ON "page_about_texts" USING btree ("order","parent_id");
CREATE INDEX "_page_about_v_version_intro_actions_order_idx" ON "_page_about_v_version_intro_actions" USING btree ("_order");
CREATE INDEX "_page_about_v_version_intro_actions_parent_id_idx" ON "_page_about_v_version_intro_actions" USING btree ("_parent_id");
CREATE INDEX "_page_about_v_version_version__status_idx" ON "_page_about_v" USING btree ("version__status");
CREATE INDEX "_page_about_v_created_at_idx" ON "_page_about_v" USING btree ("created_at");
CREATE INDEX "_page_about_v_updated_at_idx" ON "_page_about_v" USING btree ("updated_at");
CREATE INDEX "_page_about_v_latest_idx" ON "_page_about_v" USING btree ("latest");
CREATE INDEX "_page_about_v_autosave_idx" ON "_page_about_v" USING btree ("autosave");
CREATE INDEX "_page_about_v_texts_order_parent" ON "_page_about_v_texts" USING btree ("order","parent_id");
CREATE INDEX "page_contacts_intro_actions_order_idx" ON "page_contacts_intro_actions" USING btree ("_order");
CREATE INDEX "page_contacts_intro_actions_parent_id_idx" ON "page_contacts_intro_actions" USING btree ("_parent_id");
CREATE INDEX "page_contacts_faq_order_idx" ON "page_contacts_faq" USING btree ("_order");
CREATE INDEX "page_contacts_faq_parent_id_idx" ON "page_contacts_faq" USING btree ("_parent_id");
CREATE INDEX "page_contacts__status_idx" ON "page_contacts" USING btree ("_status");
CREATE INDEX "_page_contacts_v_version_intro_actions_order_idx" ON "_page_contacts_v_version_intro_actions" USING btree ("_order");
CREATE INDEX "_page_contacts_v_version_intro_actions_parent_id_idx" ON "_page_contacts_v_version_intro_actions" USING btree ("_parent_id");
CREATE INDEX "_page_contacts_v_version_faq_order_idx" ON "_page_contacts_v_version_faq" USING btree ("_order");
CREATE INDEX "_page_contacts_v_version_faq_parent_id_idx" ON "_page_contacts_v_version_faq" USING btree ("_parent_id");
CREATE INDEX "_page_contacts_v_version_version__status_idx" ON "_page_contacts_v" USING btree ("version__status");
CREATE INDEX "_page_contacts_v_created_at_idx" ON "_page_contacts_v" USING btree ("created_at");
CREATE INDEX "_page_contacts_v_updated_at_idx" ON "_page_contacts_v" USING btree ("updated_at");
CREATE INDEX "_page_contacts_v_latest_idx" ON "_page_contacts_v" USING btree ("latest");
CREATE INDEX "_page_contacts_v_autosave_idx" ON "_page_contacts_v" USING btree ("autosave");
CREATE INDEX "page_participate_intro_actions_order_idx" ON "page_participate_intro_actions" USING btree ("_order");
CREATE INDEX "page_participate_intro_actions_parent_id_idx" ON "page_participate_intro_actions" USING btree ("_parent_id");
CREATE INDEX "page_participate_participate_forms_fields_options_order_idx" ON "page_participate_participate_forms_fields_options" USING btree ("_order");
CREATE INDEX "page_participate_participate_forms_fields_options_parent_id_idx" ON "page_participate_participate_forms_fields_options" USING btree ("_parent_id");
CREATE INDEX "page_participate_participate_forms_fields_order_idx" ON "page_participate_participate_forms_fields" USING btree ("_order");
CREATE INDEX "page_participate_participate_forms_fields_parent_id_idx" ON "page_participate_participate_forms_fields" USING btree ("_parent_id");
CREATE INDEX "page_participate_participate_forms_order_idx" ON "page_participate_participate_forms" USING btree ("_order");
CREATE INDEX "page_participate_participate_forms_parent_id_idx" ON "page_participate_participate_forms" USING btree ("_parent_id");
CREATE INDEX "page_participate__status_idx" ON "page_participate" USING btree ("_status");
CREATE INDEX "_page_participate_v_version_intro_actions_order_idx" ON "_page_participate_v_version_intro_actions" USING btree ("_order");
CREATE INDEX "_page_participate_v_version_intro_actions_parent_id_idx" ON "_page_participate_v_version_intro_actions" USING btree ("_parent_id");
CREATE INDEX "_page_participate_v_version_participate_forms_fields_options_order_idx" ON "_page_participate_v_version_participate_forms_fields_options" USING btree ("_order");
CREATE INDEX "_page_participate_v_version_participate_forms_fields_options_parent_id_idx" ON "_page_participate_v_version_participate_forms_fields_options" USING btree ("_parent_id");
CREATE INDEX "_page_participate_v_version_participate_forms_fields_order_idx" ON "_page_participate_v_version_participate_forms_fields" USING btree ("_order");
CREATE INDEX "_page_participate_v_version_participate_forms_fields_parent_id_idx" ON "_page_participate_v_version_participate_forms_fields" USING btree ("_parent_id");
CREATE INDEX "_page_participate_v_version_participate_forms_order_idx" ON "_page_participate_v_version_participate_forms" USING btree ("_order");
CREATE INDEX "_page_participate_v_version_participate_forms_parent_id_idx" ON "_page_participate_v_version_participate_forms" USING btree ("_parent_id");
CREATE INDEX "_page_participate_v_version_version__status_idx" ON "_page_participate_v" USING btree ("version__status");
CREATE INDEX "_page_participate_v_created_at_idx" ON "_page_participate_v" USING btree ("created_at");
CREATE INDEX "_page_participate_v_updated_at_idx" ON "_page_participate_v" USING btree ("updated_at");
CREATE INDEX "_page_participate_v_latest_idx" ON "_page_participate_v" USING btree ("latest");
CREATE INDEX "_page_participate_v_autosave_idx" ON "_page_participate_v" USING btree ("autosave");
CREATE INDEX "page_privacy_intro_actions_order_idx" ON "page_privacy_intro_actions" USING btree ("_order");
CREATE INDEX "page_privacy_intro_actions_parent_id_idx" ON "page_privacy_intro_actions" USING btree ("_parent_id");
CREATE INDEX "page_privacy_privacy_sections_order_idx" ON "page_privacy_privacy_sections" USING btree ("_order");
CREATE INDEX "page_privacy_privacy_sections_parent_id_idx" ON "page_privacy_privacy_sections" USING btree ("_parent_id");
CREATE INDEX "page_privacy__status_idx" ON "page_privacy" USING btree ("_status");
CREATE INDEX "page_privacy_texts_order_parent" ON "page_privacy_texts" USING btree ("order","parent_id");
CREATE INDEX "_page_privacy_v_version_intro_actions_order_idx" ON "_page_privacy_v_version_intro_actions" USING btree ("_order");
CREATE INDEX "_page_privacy_v_version_intro_actions_parent_id_idx" ON "_page_privacy_v_version_intro_actions" USING btree ("_parent_id");
CREATE INDEX "_page_privacy_v_version_privacy_sections_order_idx" ON "_page_privacy_v_version_privacy_sections" USING btree ("_order");
CREATE INDEX "_page_privacy_v_version_privacy_sections_parent_id_idx" ON "_page_privacy_v_version_privacy_sections" USING btree ("_parent_id");
CREATE INDEX "_page_privacy_v_version_version__status_idx" ON "_page_privacy_v" USING btree ("version__status");
CREATE INDEX "_page_privacy_v_created_at_idx" ON "_page_privacy_v" USING btree ("created_at");
CREATE INDEX "_page_privacy_v_updated_at_idx" ON "_page_privacy_v" USING btree ("updated_at");
CREATE INDEX "_page_privacy_v_latest_idx" ON "_page_privacy_v" USING btree ("latest");
CREATE INDEX "_page_privacy_v_autosave_idx" ON "_page_privacy_v" USING btree ("autosave");
CREATE INDEX "_page_privacy_v_texts_order_parent" ON "_page_privacy_v_texts" USING btree ("order","parent_id");
CREATE INDEX "page_projects_intro_actions_order_idx" ON "page_projects_intro_actions" USING btree ("_order");
CREATE INDEX "page_projects_intro_actions_parent_id_idx" ON "page_projects_intro_actions" USING btree ("_parent_id");
CREATE INDEX "page_projects__status_idx" ON "page_projects" USING btree ("_status");
CREATE INDEX "_page_projects_v_version_intro_actions_order_idx" ON "_page_projects_v_version_intro_actions" USING btree ("_order");
CREATE INDEX "_page_projects_v_version_intro_actions_parent_id_idx" ON "_page_projects_v_version_intro_actions" USING btree ("_parent_id");
CREATE INDEX "_page_projects_v_version_version__status_idx" ON "_page_projects_v" USING btree ("version__status");
CREATE INDEX "_page_projects_v_created_at_idx" ON "_page_projects_v" USING btree ("created_at");
CREATE INDEX "_page_projects_v_updated_at_idx" ON "_page_projects_v" USING btree ("updated_at");
CREATE INDEX "_page_projects_v_latest_idx" ON "_page_projects_v" USING btree ("latest");
CREATE INDEX "_page_projects_v_autosave_idx" ON "_page_projects_v" USING btree ("autosave");
ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "pages_id";

-- (2) move existing pages content into the matching globals (pre-drop).
-- ============ DATA MOVE: pages rows -> per-page globals (#18) ============
-- Each populated page row becomes the single record of its global. Direct
-- child arrays are re-parented from the (varchar slug) pages id to the new
-- (serial) global id; chained children (forms->fields->options) keep their
-- own string parent ids. Enum columns are cast through ::text because each
-- global owns its OWN enum type (enum_page_home_locale != enum_pages_locale).

-- home -> page_home
INSERT INTO "page_home" ("title", "seo_title", "seo_description", "hero_eyebrow", "hero_sticker", "hero_title_lead", "hero_title_mark", "hero_title_trail", "hero_lead", "hero_primary_cta_label", "hero_primary_cta_href", "hero_secondary_cta_label", "hero_secondary_cta_href", "hero_proof_label", "what_is_eyebrow", "what_is_title", "showcase_eyebrow", "showcase_title", "showcase_lead", "showcase_all_link_label", "showcase_all_link_href", "path_intro_eyebrow", "path_intro_title", "path_intro_lead", "trust_eyebrow", "trust_title", "trust_lead", "contour_eyebrow", "contour_title", "contour_public_kicker", "contour_public_title", "contour_internal_kicker", "contour_internal_title", "contour_boundary", "faq_intro_eyebrow", "faq_intro_title", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale", "_status")
SELECT "title", "seo_title", "seo_description", "hero_eyebrow", "hero_sticker", "hero_title_lead", "hero_title_mark", "hero_title_trail", "hero_lead", "hero_primary_cta_label", "hero_primary_cta_href", "hero_secondary_cta_label", "hero_secondary_cta_href", "hero_proof_label", "what_is_eyebrow", "what_is_title", "showcase_eyebrow", "showcase_title", "showcase_lead", "showcase_all_link_label", "showcase_all_link_href", "path_intro_eyebrow", "path_intro_title", "path_intro_lead", "trust_eyebrow", "trust_title", "trust_lead", "contour_eyebrow", "contour_title", "contour_public_kicker", "contour_public_title", "contour_internal_kicker", "contour_internal_title", "contour_boundary", "faq_intro_eyebrow", "faq_intro_title", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale"::text::"enum_page_home_locale", "_status"::text::"enum_page_home_status" FROM "pages" WHERE "id" = 'home';
INSERT INTO "page_home_faq" ("_parent_id", "_order", "id", "question", "answer")
SELECT g.id, s."_order", s."id", s."question", s."answer" FROM "pages_faq" s CROSS JOIN "page_home" g WHERE s."_parent_id" = 'home';
INSERT INTO "page_home_path_steps" ("_parent_id", "_order", "id", "title", "body")
SELECT g.id, s."_order", s."id", s."title", s."body" FROM "pages_path_steps" s CROSS JOIN "page_home" g WHERE s."_parent_id" = 'home';
INSERT INTO "page_home_hero_proof_items" ("_parent_id", "_order", "id", "icon", "title", "body")
SELECT g.id, s."_order", s."id", s."icon", s."title", s."body" FROM "pages_hero_proof_items" s CROSS JOIN "page_home" g WHERE s."_parent_id" = 'home';
INSERT INTO "page_home_trust_stats" ("_parent_id", "_order", "id", "value", "label", "sub", "tone")
SELECT g.id, s."_order", s."id", s."value", s."label", s."sub", s."tone"::text::"enum_page_home_trust_stats_tone" FROM "pages_trust_stats" s CROSS JOIN "page_home" g WHERE s."_parent_id" = 'home';
INSERT INTO "page_home_texts" ("parent_id", "order", "path", "text")
SELECT g.id, s."order", s."path", s."text" FROM "pages_texts" s CROSS JOIN "page_home" g WHERE s."parent_id" = 'home';

-- about -> page_about
INSERT INTO "page_about" ("title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "about_what_is_eyebrow", "about_what_is_title", "about_what_is_lead", "about_goal_eyebrow", "about_goal_title", "about_goal_lead", "about_values_eyebrow", "about_values_title", "about_values_lead", "about_principles_eyebrow", "about_principles_title", "about_principles_lead", "about_approach_eyebrow", "about_approach_title", "about_approach_lead", "about_roles_eyebrow", "about_roles_title", "about_roles_lead", "about_goal_kicker", "about_mission_kicker", "about_approach_note_title", "about_approach_note_body", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale", "_status")
SELECT "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "about_what_is_eyebrow", "about_what_is_title", "about_what_is_lead", "about_goal_eyebrow", "about_goal_title", "about_goal_lead", "about_values_eyebrow", "about_values_title", "about_values_lead", "about_principles_eyebrow", "about_principles_title", "about_principles_lead", "about_approach_eyebrow", "about_approach_title", "about_approach_lead", "about_roles_eyebrow", "about_roles_title", "about_roles_lead", "about_goal_kicker", "about_mission_kicker", "about_approach_note_title", "about_approach_note_body", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale"::text::"enum_page_about_locale", "_status"::text::"enum_page_about_status" FROM "pages" WHERE "id" = 'about';
INSERT INTO "page_about_intro_actions" ("_parent_id", "_order", "id", "label", "href")
SELECT g.id, s."_order", s."id", s."label", s."href" FROM "pages_intro_actions" s CROSS JOIN "page_about" g WHERE s."_parent_id" = 'about';
INSERT INTO "page_about_texts" ("parent_id", "order", "path", "text")
SELECT g.id, s."order", s."path", s."text" FROM "pages_texts" s CROSS JOIN "page_about" g WHERE s."parent_id" = 'about';

-- contacts -> page_contacts
INSERT INTO "page_contacts" ("title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "faq_intro_eyebrow", "faq_intro_title", "contacts_eyebrow", "contacts_title", "contacts_lead", "contacts_boundary_icon", "contacts_boundary_label", "contacts_boundary_value", "contacts_note", "team_eyebrow", "team_title", "team_lead", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale", "_status")
SELECT "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "faq_intro_eyebrow", "faq_intro_title", "contacts_eyebrow", "contacts_title", "contacts_lead", "contacts_boundary_icon", "contacts_boundary_label", "contacts_boundary_value", "contacts_note", "team_eyebrow", "team_title", "team_lead", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale"::text::"enum_page_contacts_locale", "_status"::text::"enum_page_contacts_status" FROM "pages" WHERE "id" = 'contacts';
INSERT INTO "page_contacts_faq" ("_parent_id", "_order", "id", "question", "answer")
SELECT g.id, s."_order", s."id", s."question", s."answer" FROM "pages_faq" s CROSS JOIN "page_contacts" g WHERE s."_parent_id" = 'contacts';
INSERT INTO "page_contacts_intro_actions" ("_parent_id", "_order", "id", "label", "href")
SELECT g.id, s."_order", s."id", s."label", s."href" FROM "pages_intro_actions" s CROSS JOIN "page_contacts" g WHERE s."_parent_id" = 'contacts';

-- participate -> page_participate
INSERT INTO "page_participate" ("title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "participate_roles_slug", "participate_roles_eyebrow", "participate_roles_title", "participate_roles_lead", "participate_no_script_message", "participate_no_script_link_text", "participate_no_script_contacts_link_text", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale", "_status")
SELECT "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "participate_roles_slug", "participate_roles_eyebrow", "participate_roles_title", "participate_roles_lead", "participate_no_script_message", "participate_no_script_link_text", "participate_no_script_contacts_link_text", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale"::text::"enum_page_participate_locale", "_status"::text::"enum_page_participate_status" FROM "pages" WHERE "id" = 'participate';
INSERT INTO "page_participate_intro_actions" ("_parent_id", "_order", "id", "label", "href")
SELECT g.id, s."_order", s."id", s."label", s."href" FROM "pages_intro_actions" s CROSS JOIN "page_participate" g WHERE s."_parent_id" = 'participate';
INSERT INTO "page_participate_participate_forms" ("_parent_id", "_order", "id", "scenario", "eyebrow", "title", "lead", "consent_label_lead", "consent_link_text", "consent_validation_message", "submit_label", "states_success_title", "states_success_body", "states_error_title", "states_error_body", "states_unavailable_title", "states_unavailable_body", "note")
SELECT g.id, s."_order", s."id", s."scenario", s."eyebrow", s."title", s."lead", s."consent_label_lead", s."consent_link_text", s."consent_validation_message", s."submit_label", s."states_success_title", s."states_success_body", s."states_error_title", s."states_error_body", s."states_unavailable_title", s."states_unavailable_body", s."note" FROM "pages_participate_forms" s CROSS JOIN "page_participate" g WHERE s."_parent_id" = 'participate';
-- No slug WHERE filter here (unlike the sibling inserts above): forms/fields/
-- options are owned exclusively by the participate page, so every row in these
-- chained child tables already belongs to it. Their (string) parent ids are
-- carried over verbatim, keeping the forms->fields->options chain intact.
INSERT INTO "page_participate_participate_forms_fields" ("_order", "_parent_id", "id", "name", "type", "label", "placeholder", "hint", "required", "full", "autocomplete", "validation_message", "placeholder_option")
SELECT "_order", "_parent_id", "id", "name", "type"::text::"enum_page_participate_participate_forms_fields_type", "label", "placeholder", "hint", "required", "full", "autocomplete", "validation_message", "placeholder_option" FROM "pages_participate_forms_fields";
INSERT INTO "page_participate_participate_forms_fields_options" ("_order", "_parent_id", "id", "value", "label")
SELECT "_order", "_parent_id", "id", "value", "label" FROM "pages_participate_forms_fields_options";

-- privacy -> page_privacy
INSERT INTO "page_privacy" ("title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "privacy_draft_note_label", "privacy_draft_note_body", "privacy_operator_slug", "privacy_operator_heading", "privacy_consent_anchor", "privacy_consent_label", "locale", "_status")
SELECT "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "privacy_draft_note_label", "privacy_draft_note_body", "privacy_operator_slug", "privacy_operator_heading", "privacy_consent_anchor", "privacy_consent_label", "locale"::text::"enum_page_privacy_locale", "_status"::text::"enum_page_privacy_status" FROM "pages" WHERE "id" = 'privacy';
INSERT INTO "page_privacy_intro_actions" ("_parent_id", "_order", "id", "label", "href")
SELECT g.id, s."_order", s."id", s."label", s."href" FROM "pages_intro_actions" s CROSS JOIN "page_privacy" g WHERE s."_parent_id" = 'privacy';
INSERT INTO "page_privacy_privacy_sections" ("_parent_id", "_order", "id", "heading")
SELECT g.id, s."_order", s."id", s."heading" FROM "pages_privacy_sections" s CROSS JOIN "page_privacy" g WHERE s."_parent_id" = 'privacy';
INSERT INTO "page_privacy_texts" ("parent_id", "order", "path", "text")
SELECT g.id, s."order", s."path", s."text" FROM "pages_texts" s CROSS JOIN "page_privacy" g WHERE s."parent_id" = 'privacy';

-- projects -> page_projects
INSERT INTO "page_projects" ("title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "filters_label", "filters_all_label", "locale", "_status")
SELECT "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "filters_label", "filters_all_label", "locale"::text::"enum_page_projects_locale", "_status"::text::"enum_page_projects_status" FROM "pages" WHERE "id" = 'projects';
INSERT INTO "page_projects_intro_actions" ("_parent_id", "_order", "id", "label", "href")
SELECT g.id, s."_order", s."id", s."label", s."href" FROM "pages_intro_actions" s CROSS JOIN "page_projects" g WHERE s."_parent_id" = 'projects';
-- (3) retire the now-empty pages collection tables + enums.
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
-- ---------------------------------------------------------------------------
-- INTENTIONAL: the #14 draft/autosave version HISTORY (_pages_v + children) is
-- discarded here, NOT migrated into the new "_page_*_v" tables. This is a
-- deliberate tradeoff, not an omission: only the current PUBLISHED snapshot of
-- each page (the live "pages" row, already copied into its global above) needs
-- to survive the split. Prior draft/autosave versions are throwaway working
-- state; the new per-page globals simply start their version history fresh.
-- ---------------------------------------------------------------------------
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
DROP TYPE "public"."enum_pages_trust_stats_tone";
DROP TYPE "public"."enum_pages_participate_forms_fields_type";
DROP TYPE "public"."enum_pages_locale";
DROP TYPE "public"."enum_pages_status";
DROP TYPE "public"."enum__pages_v_version_trust_stats_tone";
DROP TYPE "public"."enum__pages_v_version_participate_forms_fields_type";
DROP TYPE "public"."enum__pages_v_version_locale";
DROP TYPE "public"."enum__pages_v_version_status";
`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
-- Reverse of #18: restore the 'pages' collection from the 6 page globals.
-- (1) recreate the pages tables + enums.
CREATE TYPE "public"."enum_pages_trust_stats_tone" AS ENUM('default', 'teal', 'empty');
CREATE TYPE "public"."enum_pages_participate_forms_fields_type" AS ENUM('text', 'email', 'tel', 'select', 'textarea');
CREATE TYPE "public"."enum_pages_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum_pages_status" AS ENUM('draft', 'published');
CREATE TYPE "public"."enum__pages_v_version_trust_stats_tone" AS ENUM('default', 'teal', 'empty');
CREATE TYPE "public"."enum__pages_v_version_participate_forms_fields_type" AS ENUM('text', 'email', 'tel', 'select', 'textarea');
CREATE TYPE "public"."enum__pages_v_version_locale" AS ENUM('ru', 'en');
CREATE TYPE "public"."enum__pages_v_version_status" AS ENUM('draft', 'published');
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
	"type" "enum_pages_participate_forms_fields_type",
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
	-- title/locale are nullable here on purpose: down() restores the state that
	-- existed immediately BEFORE this migration, i.e. post-#14, whose up() dropped
	-- the NOT NULL on pages.title/locale for drafts. (bbmp_28 had them NOT NULL,
	-- but that is not the state #18.up() replaced.)
	"title" varchar,
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
	"locale" "enum_pages_locale" DEFAULT 'ru',
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"_status" "enum_pages_status" DEFAULT 'draft'
);

CREATE TABLE "pages_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" varchar NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
);

-- NB: down() recreates the _pages_v* version tables EMPTY. The draft/autosave
-- version history dropped by up() is NOT restored (it was intentionally
-- discarded); only the current published content is moved back into "pages".
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
CREATE INDEX "pages__status_idx" ON "pages" USING btree ("_status");
CREATE INDEX "pages_texts_order_parent" ON "pages_texts" USING btree ("order","parent_id");
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

-- (2) restore the locked-documents relation to pages.
ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "pages_id" varchar;
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "payload_locked_documents_rels_pages_id_idx" ON "payload_locked_documents_rels" USING btree ("pages_id");

-- (3) move global content back into pages (genuine inverse of the up data move).
-- ============ DATA MOVE (DOWN): per-page globals -> pages (#18 inverse) ============
-- Enum columns cast through ::text back into the pages enum types.

-- page_home -> home
INSERT INTO "pages" ("id", "title", "seo_title", "seo_description", "hero_eyebrow", "hero_sticker", "hero_title_lead", "hero_title_mark", "hero_title_trail", "hero_lead", "hero_primary_cta_label", "hero_primary_cta_href", "hero_secondary_cta_label", "hero_secondary_cta_href", "hero_proof_label", "what_is_eyebrow", "what_is_title", "showcase_eyebrow", "showcase_title", "showcase_lead", "showcase_all_link_label", "showcase_all_link_href", "path_intro_eyebrow", "path_intro_title", "path_intro_lead", "trust_eyebrow", "trust_title", "trust_lead", "contour_eyebrow", "contour_title", "contour_public_kicker", "contour_public_title", "contour_internal_kicker", "contour_internal_title", "contour_boundary", "faq_intro_eyebrow", "faq_intro_title", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale", "_status")
SELECT 'home', "title", "seo_title", "seo_description", "hero_eyebrow", "hero_sticker", "hero_title_lead", "hero_title_mark", "hero_title_trail", "hero_lead", "hero_primary_cta_label", "hero_primary_cta_href", "hero_secondary_cta_label", "hero_secondary_cta_href", "hero_proof_label", "what_is_eyebrow", "what_is_title", "showcase_eyebrow", "showcase_title", "showcase_lead", "showcase_all_link_label", "showcase_all_link_href", "path_intro_eyebrow", "path_intro_title", "path_intro_lead", "trust_eyebrow", "trust_title", "trust_lead", "contour_eyebrow", "contour_title", "contour_public_kicker", "contour_public_title", "contour_internal_kicker", "contour_internal_title", "contour_boundary", "faq_intro_eyebrow", "faq_intro_title", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale"::text::"enum_pages_locale", "_status"::text::"enum_pages_status" FROM "page_home";
INSERT INTO "pages_faq" ("_parent_id", "_order", "id", "question", "answer")
SELECT 'home', "_order", "id", "question", "answer" FROM "page_home_faq";
INSERT INTO "pages_path_steps" ("_parent_id", "_order", "id", "title", "body")
SELECT 'home', "_order", "id", "title", "body" FROM "page_home_path_steps";
INSERT INTO "pages_hero_proof_items" ("_parent_id", "_order", "id", "icon", "title", "body")
SELECT 'home', "_order", "id", "icon", "title", "body" FROM "page_home_hero_proof_items";
INSERT INTO "pages_trust_stats" ("_parent_id", "_order", "id", "value", "label", "sub", "tone")
SELECT 'home', "_order", "id", "value", "label", "sub", "tone"::text::"enum_pages_trust_stats_tone" FROM "page_home_trust_stats";
INSERT INTO "pages_texts" ("parent_id", "order", "path", "text")
SELECT 'home', "order", "path", "text" FROM "page_home_texts";

-- page_about -> about
INSERT INTO "pages" ("id", "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "about_what_is_eyebrow", "about_what_is_title", "about_what_is_lead", "about_goal_eyebrow", "about_goal_title", "about_goal_lead", "about_values_eyebrow", "about_values_title", "about_values_lead", "about_principles_eyebrow", "about_principles_title", "about_principles_lead", "about_approach_eyebrow", "about_approach_title", "about_approach_lead", "about_roles_eyebrow", "about_roles_title", "about_roles_lead", "about_goal_kicker", "about_mission_kicker", "about_approach_note_title", "about_approach_note_body", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale", "_status")
SELECT 'about', "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "about_what_is_eyebrow", "about_what_is_title", "about_what_is_lead", "about_goal_eyebrow", "about_goal_title", "about_goal_lead", "about_values_eyebrow", "about_values_title", "about_values_lead", "about_principles_eyebrow", "about_principles_title", "about_principles_lead", "about_approach_eyebrow", "about_approach_title", "about_approach_lead", "about_roles_eyebrow", "about_roles_title", "about_roles_lead", "about_goal_kicker", "about_mission_kicker", "about_approach_note_title", "about_approach_note_body", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale"::text::"enum_pages_locale", "_status"::text::"enum_pages_status" FROM "page_about";
INSERT INTO "pages_intro_actions" ("_parent_id", "_order", "id", "label", "href")
SELECT 'about', "_order", "id", "label", "href" FROM "page_about_intro_actions";
INSERT INTO "pages_texts" ("parent_id", "order", "path", "text")
SELECT 'about', "order", "path", "text" FROM "page_about_texts";

-- page_contacts -> contacts
INSERT INTO "pages" ("id", "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "faq_intro_eyebrow", "faq_intro_title", "contacts_eyebrow", "contacts_title", "contacts_lead", "contacts_boundary_icon", "contacts_boundary_label", "contacts_boundary_value", "contacts_note", "team_eyebrow", "team_title", "team_lead", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale", "_status")
SELECT 'contacts', "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "faq_intro_eyebrow", "faq_intro_title", "contacts_eyebrow", "contacts_title", "contacts_lead", "contacts_boundary_icon", "contacts_boundary_label", "contacts_boundary_value", "contacts_note", "team_eyebrow", "team_title", "team_lead", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale"::text::"enum_pages_locale", "_status"::text::"enum_pages_status" FROM "page_contacts";
INSERT INTO "pages_faq" ("_parent_id", "_order", "id", "question", "answer")
SELECT 'contacts', "_order", "id", "question", "answer" FROM "page_contacts_faq";
INSERT INTO "pages_intro_actions" ("_parent_id", "_order", "id", "label", "href")
SELECT 'contacts', "_order", "id", "label", "href" FROM "page_contacts_intro_actions";

-- page_participate -> participate
INSERT INTO "pages" ("id", "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "participate_roles_slug", "participate_roles_eyebrow", "participate_roles_title", "participate_roles_lead", "participate_no_script_message", "participate_no_script_link_text", "participate_no_script_contacts_link_text", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale", "_status")
SELECT 'participate', "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "participate_roles_slug", "participate_roles_eyebrow", "participate_roles_title", "participate_roles_lead", "participate_no_script_message", "participate_no_script_link_text", "participate_no_script_contacts_link_text", "cta_title", "cta_lead", "cta_primary_cta_label", "cta_primary_cta_href", "cta_secondary_cta_label", "cta_secondary_cta_href", "locale"::text::"enum_pages_locale", "_status"::text::"enum_pages_status" FROM "page_participate";
INSERT INTO "pages_intro_actions" ("_parent_id", "_order", "id", "label", "href")
SELECT 'participate', "_order", "id", "label", "href" FROM "page_participate_intro_actions";
INSERT INTO "pages_participate_forms" ("_parent_id", "_order", "id", "scenario", "eyebrow", "title", "lead", "consent_label_lead", "consent_link_text", "consent_validation_message", "submit_label", "states_success_title", "states_success_body", "states_error_title", "states_error_body", "states_unavailable_title", "states_unavailable_body", "note")
SELECT 'participate', "_order", "id", "scenario", "eyebrow", "title", "lead", "consent_label_lead", "consent_link_text", "consent_validation_message", "submit_label", "states_success_title", "states_success_body", "states_error_title", "states_error_body", "states_unavailable_title", "states_unavailable_body", "note" FROM "page_participate_participate_forms";
INSERT INTO "pages_participate_forms_fields" ("_order", "_parent_id", "id", "name", "type", "label", "placeholder", "hint", "required", "full", "autocomplete", "validation_message", "placeholder_option")
SELECT "_order", "_parent_id", "id", "name", "type"::text::"enum_pages_participate_forms_fields_type", "label", "placeholder", "hint", "required", "full", "autocomplete", "validation_message", "placeholder_option" FROM "page_participate_participate_forms_fields";
INSERT INTO "pages_participate_forms_fields_options" ("_order", "_parent_id", "id", "value", "label")
SELECT "_order", "_parent_id", "id", "value", "label" FROM "page_participate_participate_forms_fields_options";

-- page_privacy -> privacy
INSERT INTO "pages" ("id", "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "privacy_draft_note_label", "privacy_draft_note_body", "privacy_operator_slug", "privacy_operator_heading", "privacy_consent_anchor", "privacy_consent_label", "locale", "_status")
SELECT 'privacy', "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "privacy_draft_note_label", "privacy_draft_note_body", "privacy_operator_slug", "privacy_operator_heading", "privacy_consent_anchor", "privacy_consent_label", "locale"::text::"enum_pages_locale", "_status"::text::"enum_pages_status" FROM "page_privacy";
INSERT INTO "pages_intro_actions" ("_parent_id", "_order", "id", "label", "href")
SELECT 'privacy', "_order", "id", "label", "href" FROM "page_privacy_intro_actions";
INSERT INTO "pages_privacy_sections" ("_parent_id", "_order", "id", "heading")
SELECT 'privacy', "_order", "id", "heading" FROM "page_privacy_privacy_sections";
INSERT INTO "pages_texts" ("parent_id", "order", "path", "text")
SELECT 'privacy', "order", "path", "text" FROM "page_privacy_texts";

-- page_projects -> projects
INSERT INTO "pages" ("id", "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "filters_label", "filters_all_label", "locale", "_status")
SELECT 'projects', "title", "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_lead", "filters_label", "filters_all_label", "locale"::text::"enum_pages_locale", "_status"::text::"enum_pages_status" FROM "page_projects";
INSERT INTO "pages_intro_actions" ("_parent_id", "_order", "id", "label", "href")
SELECT 'projects', "_order", "id", "label", "href" FROM "page_projects_intro_actions";
-- (4) drop the page-global tables + enums.
ALTER TABLE "page_home_hero_proof_items" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_home_trust_stats" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_home_faq" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_home_path_steps" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_home" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_home_texts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_home_v_version_hero_proof_items" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_home_v_version_trust_stats" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_home_v_version_faq" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_home_v_version_path_steps" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_home_v" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_home_v_texts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_about_intro_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_about" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_about_texts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_about_v_version_intro_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_about_v" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_about_v_texts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_contacts_intro_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_contacts_faq" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_contacts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_contacts_v_version_intro_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_contacts_v_version_faq" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_contacts_v" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_participate_intro_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_participate_participate_forms_fields_options" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_participate_participate_forms_fields" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_participate_participate_forms" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_participate" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_participate_v_version_intro_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_participate_v_version_participate_forms_fields_options" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_participate_v_version_participate_forms_fields" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_participate_v_version_participate_forms" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_participate_v" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_privacy_intro_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_privacy_privacy_sections" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_privacy" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_privacy_texts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_privacy_v_version_intro_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_privacy_v_version_privacy_sections" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_privacy_v" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_privacy_v_texts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_projects_intro_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "page_projects" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_projects_v_version_intro_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_page_projects_v" DISABLE ROW LEVEL SECURITY;
DROP TABLE "page_home_hero_proof_items" CASCADE;
DROP TABLE "page_home_trust_stats" CASCADE;
DROP TABLE "page_home_faq" CASCADE;
DROP TABLE "page_home_path_steps" CASCADE;
DROP TABLE "page_home" CASCADE;
DROP TABLE "page_home_texts" CASCADE;
DROP TABLE "_page_home_v_version_hero_proof_items" CASCADE;
DROP TABLE "_page_home_v_version_trust_stats" CASCADE;
DROP TABLE "_page_home_v_version_faq" CASCADE;
DROP TABLE "_page_home_v_version_path_steps" CASCADE;
DROP TABLE "_page_home_v" CASCADE;
DROP TABLE "_page_home_v_texts" CASCADE;
DROP TABLE "page_about_intro_actions" CASCADE;
DROP TABLE "page_about" CASCADE;
DROP TABLE "page_about_texts" CASCADE;
DROP TABLE "_page_about_v_version_intro_actions" CASCADE;
DROP TABLE "_page_about_v" CASCADE;
DROP TABLE "_page_about_v_texts" CASCADE;
DROP TABLE "page_contacts_intro_actions" CASCADE;
DROP TABLE "page_contacts_faq" CASCADE;
DROP TABLE "page_contacts" CASCADE;
DROP TABLE "_page_contacts_v_version_intro_actions" CASCADE;
DROP TABLE "_page_contacts_v_version_faq" CASCADE;
DROP TABLE "_page_contacts_v" CASCADE;
DROP TABLE "page_participate_intro_actions" CASCADE;
DROP TABLE "page_participate_participate_forms_fields_options" CASCADE;
DROP TABLE "page_participate_participate_forms_fields" CASCADE;
DROP TABLE "page_participate_participate_forms" CASCADE;
DROP TABLE "page_participate" CASCADE;
DROP TABLE "_page_participate_v_version_intro_actions" CASCADE;
DROP TABLE "_page_participate_v_version_participate_forms_fields_options" CASCADE;
DROP TABLE "_page_participate_v_version_participate_forms_fields" CASCADE;
DROP TABLE "_page_participate_v_version_participate_forms" CASCADE;
DROP TABLE "_page_participate_v" CASCADE;
DROP TABLE "page_privacy_intro_actions" CASCADE;
DROP TABLE "page_privacy_privacy_sections" CASCADE;
DROP TABLE "page_privacy" CASCADE;
DROP TABLE "page_privacy_texts" CASCADE;
DROP TABLE "_page_privacy_v_version_intro_actions" CASCADE;
DROP TABLE "_page_privacy_v_version_privacy_sections" CASCADE;
DROP TABLE "_page_privacy_v" CASCADE;
DROP TABLE "_page_privacy_v_texts" CASCADE;
DROP TABLE "page_projects_intro_actions" CASCADE;
DROP TABLE "page_projects" CASCADE;
DROP TABLE "_page_projects_v_version_intro_actions" CASCADE;
DROP TABLE "_page_projects_v" CASCADE;
DROP TYPE "public"."enum_page_home_trust_stats_tone";
DROP TYPE "public"."enum_page_home_locale";
DROP TYPE "public"."enum_page_home_status";
DROP TYPE "public"."enum__page_home_v_version_trust_stats_tone";
DROP TYPE "public"."enum__page_home_v_version_locale";
DROP TYPE "public"."enum__page_home_v_version_status";
DROP TYPE "public"."enum_page_about_locale";
DROP TYPE "public"."enum_page_about_status";
DROP TYPE "public"."enum__page_about_v_version_locale";
DROP TYPE "public"."enum__page_about_v_version_status";
DROP TYPE "public"."enum_page_contacts_locale";
DROP TYPE "public"."enum_page_contacts_status";
DROP TYPE "public"."enum__page_contacts_v_version_locale";
DROP TYPE "public"."enum__page_contacts_v_version_status";
DROP TYPE "public"."enum_page_participate_participate_forms_fields_type";
DROP TYPE "public"."enum_page_participate_locale";
DROP TYPE "public"."enum_page_participate_status";
DROP TYPE "public"."enum__page_participate_v_version_participate_forms_fields_type";
DROP TYPE "public"."enum__page_participate_v_version_locale";
DROP TYPE "public"."enum__page_participate_v_version_status";
DROP TYPE "public"."enum_page_privacy_locale";
DROP TYPE "public"."enum_page_privacy_status";
DROP TYPE "public"."enum__page_privacy_v_version_locale";
DROP TYPE "public"."enum__page_privacy_v_version_status";
DROP TYPE "public"."enum_page_projects_locale";
DROP TYPE "public"."enum_page_projects_status";
DROP TYPE "public"."enum__page_projects_v_version_locale";
DROP TYPE "public"."enum__page_projects_v_version_status";
`)
}
