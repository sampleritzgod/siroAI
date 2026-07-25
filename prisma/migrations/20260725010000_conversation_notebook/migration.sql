-- AlterTable: add nullable notebookId for backfill
ALTER TABLE "Conversation" ADD COLUMN "notebookId" TEXT;

-- Create default "My Notebook" for every user that has conversations
-- and does not already have a notebook with that title.
INSERT INTO "Notebook" ("id", "userId", "title", "description", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || u.id),
  u.id,
  'My Notebook',
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE EXISTS (
  SELECT 1 FROM "Conversation" c WHERE c."userId" = u.id
)
AND NOT EXISTS (
  SELECT 1
  FROM "Notebook" n
  WHERE n."userId" = u.id
    AND n.title = 'My Notebook'
);

-- Attach legacy conversations to each user's default notebook
UPDATE "Conversation" c
SET "notebookId" = (
  SELECT n.id
  FROM "Notebook" n
  WHERE n."userId" = c."userId"
    AND n.title = 'My Notebook'
  ORDER BY n."createdAt" ASC
  LIMIT 1
)
WHERE c."notebookId" IS NULL;

-- Safety: any remaining orphans (should not happen) get a notebook
INSERT INTO "Notebook" ("id", "userId", "title", "description", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || orphan."userId"),
  orphan."userId",
  'My Notebook',
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT c."userId"
  FROM "Conversation" c
  WHERE c."notebookId" IS NULL
) AS orphan
WHERE NOT EXISTS (
  SELECT 1
  FROM "Notebook" n
  WHERE n."userId" = orphan."userId"
    AND n.title = 'My Notebook'
);

UPDATE "Conversation" c
SET "notebookId" = (
  SELECT n.id
  FROM "Notebook" n
  WHERE n."userId" = c."userId"
    AND n.title = 'My Notebook'
  ORDER BY n."createdAt" ASC
  LIMIT 1
)
WHERE c."notebookId" IS NULL;

-- Require notebookId going forward
ALTER TABLE "Conversation" ALTER COLUMN "notebookId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Notebook_userId_title_idx" ON "Notebook"("userId", "title");

-- CreateIndex
CREATE INDEX "Conversation_notebookId_lastMessageAt_idx" ON "Conversation"("notebookId", "lastMessageAt" DESC);

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
