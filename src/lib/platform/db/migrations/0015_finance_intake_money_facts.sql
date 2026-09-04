ALTER TABLE "core"."finance_intake_item" DROP CONSTRAINT "finance_intake_item_personal_funds_account";--> statement-breakpoint
ALTER TABLE "core"."finance_intake_item" ALTER COLUMN "occurred_on" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."finance_intake_item" ADD CONSTRAINT "finance_intake_item_money_facts" CHECK (("core"."finance_intake_item"."source" = 'request' and not "core"."finance_intake_item"."already_paid" and "core"."finance_intake_item"."status" <> 'posted')
        or ("core"."finance_intake_item"."occurred_on" is not null
          and ("core"."finance_intake_item"."personal_funds" or "core"."finance_intake_item"."account_id" is not null)));--> statement-breakpoint
ALTER TABLE "core"."finance_intake_item" ADD CONSTRAINT "finance_intake_item_personal_funds_account" CHECK ((not "core"."finance_intake_item"."personal_funds") or ("core"."finance_intake_item"."account_id" is null));