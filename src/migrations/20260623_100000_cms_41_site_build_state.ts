import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // #41: `siteBuildState` global — versionless, drafts-disabled. Plain global
  // table (id + data columns + updated_at/created_at), shaped exactly like the
  // pre-drafts globals (`contact`, `site_chrome`): no `_status` (no versions) and
  // no `locale` (no localized fields). The two date fields map to Payload's
  // postgres `timestamp(3) with time zone`; `last_dispatch_error` is text.
  await db.execute(sql`
  CREATE TABLE "site_build_state" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"last_published_at" timestamp(3) with time zone,
  	"last_dispatch_at" timestamp(3) with time zone,
  	"last_dispatch_error" varchar,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP TABLE "site_build_state" CASCADE;`)
}
