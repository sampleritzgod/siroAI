import { logger } from "@/lib/logger";

type StageFields = Record<string, unknown>;

/**
 * Structured stage timer for the NotebookLM RAG pipeline.
 * Emits: [STAGE] Started | Completed | Error (+ durationMs).
 */
export function stageLog(stage: string) {
  const startedAt = Date.now();

  return {
    started(fields?: StageFields) {
      logger.info(`[${stage}] Started`, fields);
    },
    completed(fields?: StageFields) {
      logger.info(`[${stage}] Completed`, {
        ...fields,
        durationMs: Date.now() - startedAt,
      });
    },
    error(error: unknown, fields?: StageFields) {
      logger.error(`[${stage}] Error`, {
        ...fields,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  };
}
