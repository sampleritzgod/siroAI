-- ANN index for RAG retrieval. Without this, every chat turn scans all
-- DocumentChunk rows and computes cosine distance — latency grows with
-- total corpus size across all tenants.
--
-- HNSW + cosine ops matches the <=> operator used in retrieve.ts.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
ON "DocumentChunk"
USING hnsw (embedding vector_cosine_ops);
