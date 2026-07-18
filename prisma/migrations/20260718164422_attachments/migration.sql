-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "AttachmentStorage" AS ENUM ('LOCAL', 'VERCEL_BLOB');

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "filename" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storage" "AttachmentStorage" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'UPLOADING',
    "extractedText" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attachment_conversationId_createdAt_idx" ON "Attachment"("conversationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Attachment_userId_createdAt_idx" ON "Attachment"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
