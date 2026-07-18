-- Enable pgvector (Neon supports this extension).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentChunk_conversationId_idx" ON "DocumentChunk"("conversationId");

-- CreateIndex
CREATE INDEX "DocumentChunk_attachmentId_idx" ON "DocumentChunk"("attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_attachmentId_chunkIndex_key" ON "DocumentChunk"("attachmentId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
