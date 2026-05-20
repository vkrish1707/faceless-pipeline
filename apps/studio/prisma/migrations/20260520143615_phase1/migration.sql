-- AlterTable
ALTER TABLE "Idea" ADD COLUMN "candidateHooks" JSONB;
ALTER TABLE "Idea" ADD COLUMN "sourceQuotes" JSONB;

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payload" JSONB,
    "result" JSONB,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Job_targetType_targetId_type_idx" ON "Job"("targetType", "targetId", "type");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");
