-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'WEBSITE';

-- AlterTable
ALTER TABLE "Source" ADD COLUMN "url" TEXT;

-- CreateIndex
CREATE INDEX "Source_notebookId_url_idx" ON "Source"("notebookId", "url");
