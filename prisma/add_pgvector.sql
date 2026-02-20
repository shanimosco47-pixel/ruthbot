-- Run this AFTER prisma migrate to enable pgvector and add the embedding column.
-- Requires pgvector extension installed on PostgreSQL.
-- On managed services (Supabase, Neon, etc.) this is usually pre-installed.

-- Step 1: Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: Add embedding column to session_embeddings
-- text-embedding-3-small outputs 1536 dimensions
ALTER TABLE session_embeddings
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Step 3: Create index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_session_embeddings_vector
  ON session_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
