-- CreateTable
CREATE TABLE "PexelsCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "queryKey" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scriptId" TEXT,
    "beatIndex" INTEGER,
    "type" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "localPath" TEXT NOT NULL,
    "thumbPath" TEXT,
    "keyword" TEXT,
    "durationSec" REAL,
    "width" INTEGER,
    "height" INTEGER,
    "pickedAt" DATETIME,
    CONSTRAINT "Asset_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Asset" ("beatIndex", "id", "keyword", "localPath", "pickedAt", "scriptId", "sourceUrl", "type") SELECT "beatIndex", "id", "keyword", "localPath", "pickedAt", "scriptId", "sourceUrl", "type" FROM "Asset";
DROP TABLE "Asset";
ALTER TABLE "new_Asset" RENAME TO "Asset";
CREATE INDEX "Asset_scriptId_beatIndex_idx" ON "Asset"("scriptId", "beatIndex");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PexelsCache_queryKey_key" ON "PexelsCache"("queryKey");
