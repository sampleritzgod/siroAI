import { notFound } from "next/navigation";
import { invalidateConversationCaches } from "@/lib/cache/invalidate";
import { prisma } from "@/lib/db";
import { loadChatMessages } from "@/modules/ai/chat-store";
import {
  listConfiguredModels,
  resolveConfiguredModelId,
} from "@/modules/ai/model-registry";
import { hasTavilyApiKey } from "@/modules/ai/tools/providers/tavily";
import { listBranches } from "@/modules/conversation/actions/branch-actions";
import { getConversation } from "@/modules/conversation/actions/conversation-actions";
import { getShareState } from "@/modules/conversation/actions/share-actions";
import { ConversationView } from "@/modules/conversation/components/conversation-view";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ branch?: string }>;
};

export default async function ConversationPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { branch: branchQuery } = await searchParams;
  const conversation = await getConversation(id);

  if (!conversation) {
    notFound();
  }

  const branches = await listBranches(conversation.id);
  const rootBranchId = conversation.branches[0]?.id ?? null;

  const requestedBranchId = branchQuery?.trim() || null;
  const requestedExists = requestedBranchId
    ? branches.some((branch) => branch.id === requestedBranchId)
    : false;

  const branchId =
    (requestedExists ? requestedBranchId : null) ||
    conversation.activeBranchId ||
    rootBranchId;

  if (!branchId) {
    notFound();
  }

  const models = listConfiguredModels();
  const modelId = resolveConfiguredModelId(conversation.model);

  // Heal chats stuck on a provider that isn't configured (e.g. Gemini removed).
  // Do not call updateConversation here — it revalidatePath()s and breaks render.
  if (conversation.model !== modelId) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { model: modelId },
    });
    await invalidateConversationCaches({
      userId: conversation.userId,
      conversationId: conversation.id,
    });
  }

  const [initialMessages, initialShare] = await Promise.all([
    loadChatMessages(conversation.id, branchId),
    getShareState(conversation.id),
  ]);

  return (
    <ConversationView
      key={`${conversation.id}:${branchId}`}
      conversationId={conversation.id}
      branchId={branchId}
      title={conversation.title}
      initialMessages={initialMessages}
      branches={branches}
      models={models}
      modelId={modelId}
      webSearchConfigured={hasTavilyApiKey()}
      initialShare={initialShare}
    />
  );
}
