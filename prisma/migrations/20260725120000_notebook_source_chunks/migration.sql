-- Allow DocumentChunk rows for notebook sources (in addition to conversation attachments).

ALTER TABLE "DocumentChunk" DROP CONSTRAINT IF EXISTS "DocumentChunk_conversationId_fkey";
ALTER TABLE "DocumentChunk" DROP CONSTRAINT IF EXISTS "DocumentChunk_attachmentId_fkey";

ALTER TABLE "DocumentChunk" ALTER COLUMN "conversationId" DROP NOT NULL;
ALTER TABLE "DocumentChunk" ALTER COLUMN "attachmentId" DROP NOT NULL;

ALTER TABLE "DocumentChunk" ADD COLUMN IF NOT EXISTS "notebookId" TEXT;
ALTER TABLE "DocumentChunk" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;

CREATE INDEX IF NOT EXISTS "DocumentChunk_notebookId_idx" ON "DocumentChunk"("notebookId");
CREATE INDEX IF NOT EXISTS "DocumentChunk_sourceId_idx" ON "DocumentChunk"("sourceId");

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentChunk_sourceId_chunkIndex_key"
  ON "DocumentChunk"("sourceId", "chunkIndex");

ALTER TABLE "DocumentChunk"
  ADD CONSTRAINT "DocumentChunk_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentChunk"
  ADD CONSTRAINT "DocumentChunk_attachmentId_fkey"
  FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentChunk"
  ADD CONSTRAINT "DocumentChunk_notebookId_fkey"
  FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentChunk"
  ADD CONSTRAINT "DocumentChunk_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "Source"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
