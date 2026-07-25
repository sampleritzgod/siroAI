-- Soft-delete support for notebooks (preserve sources, chats, and history).
ALTER TABLE "Notebook" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Notebook_userId_deletedAt_idx"
  ON "Notebook"("userId", "deletedAt");
