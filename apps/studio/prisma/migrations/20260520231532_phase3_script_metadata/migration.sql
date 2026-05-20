-- AlterTable
ALTER TABLE "Script" ADD COLUMN "approvedAt" DATETIME;
ALTER TABLE "Script" ADD COLUMN "generatedAt" DATETIME;
ALTER TABLE "Script" ADD COLUMN "lastEditedAt" DATETIME;
ALTER TABLE "Script" ADD COLUMN "scoreBreakdown" JSONB;
ALTER TABLE "Script" ADD COLUMN "warnings" JSONB;
