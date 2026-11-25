CREATE TYPE "public"."column_intent" AS ENUM('none', 'primary', 'success', 'warning', 'danger');--> statement-breakpoint
CREATE TABLE "board_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"intent" "column_intent" DEFAULT 'none' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"legacy_key" text
);
--> statement-breakpoint
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_columns_project_id_idx" ON "board_columns" USING btree ("project_id");--> statement-breakpoint
-- Every existing project gets the five columns it used to have built in.
INSERT INTO "board_columns" ("project_id", "title", "intent", "position", "legacy_key")
SELECT p."id", d."title", d."intent"::"column_intent", d."position", d."legacy_key"
FROM "projects" p
CROSS JOIN (VALUES
	('backlog', 'Backlog', 'none', 0),
	('todo', 'To do', 'none', 1),
	('progress', 'In progress', 'primary', 2),
	('review', 'In review', 'warning', 3),
	('done', 'Done', 'success', 4)
) AS d("legacy_key", "title", "intent", "position");--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "column_id" uuid;--> statement-breakpoint
UPDATE "tasks" t SET "column_id" = c."id"
FROM "board_columns" c
WHERE c."project_id" = t."project_id" AND c."legacy_key" = t."column"::text;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "column_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_column_id_board_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."board_columns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_column_id_idx" ON "tasks" USING btree ("column_id");--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "column";--> statement-breakpoint
ALTER TABLE "board_columns" DROP COLUMN "legacy_key";--> statement-breakpoint
DROP TYPE "public"."board_column";
