# SiroAI

Notebook-style AI app. Upload sources (PDF, text, VTT, website, YouTube), chat with them, and open citations in a source viewer.

**Live:** https://siro-ai-nu.vercel.app/  
**GitHub:** https://github.com/sampleritzgod/siroAI

## Tech stack

| Layer | What we used |
|--------|----------------|
| App | Next.js, React, TypeScript, Tailwind |
| Auth | Clerk |
| Database | Postgres (Neon) + Prisma |
| Vectors / RAG | pgvector + OpenAI `text-embedding-3-small` |
| Chat / models | Vercel AI SDK (OpenAI; optional Anthropic / Google) |
| File storage | **Amazon S3** (presigned browser upload) |
| Cache / rate limits | Upstash Redis |
| Optional | Tavily (web search), Supadata (YouTube transcripts) |
| Hosting | Vercel |

## Honest status

This is a learning / demo project. **It does not scale well.**

- Uploads can be **slow**, and large PDFs are painful (Vercel body limits + S3 direct upload).
- After upload, **indexing / refresh** often feels stuck — you wait, reload, and the UI may not update until sources are fully indexed.
- Some flows (especially big files, image-only PDFs, or misconfigured AWS keys on Vercel) **still fail or feel unfinished**.
- Not built for production traffic, multi-tenant scale, or fast polish.

Use it to try the idea. Don’t expect NotebookLM-level speed or reliability yet.

## Run locally

```bash
pnpm install
cp .env.example .env.local
# set DATABASE_URL, Clerk, OPENAI_API_KEY, AWS S3 vars
pnpm db:deploy
pnpm dev
```

Open http://localhost:3000  

Full env list: `.env.example`
