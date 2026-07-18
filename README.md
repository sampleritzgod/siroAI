# SiroAI

SiroAI is a ChatGPT-style web app. You sign in, start a chat, pick a model, and get streaming answers. You can attach files, turn on web search when you need fresh info, and branch a conversation if you want to try a different direction without losing the original thread. When you’re ready to show someone a chat, you can create a read-only share link.

The project is built with Next.js, React, Clerk for login, Postgres for data, and the Vercel AI SDK for models. Package manager is pnpm.

## What you need

Before you start, have these ready:

- Node.js 20 or newer, and pnpm  
- A Postgres database (Neon is fine). Turn on **pgvector** if you want document search (RAG).  
- Clerk publishable and secret keys  
- An OpenAI API key  

Optional later: Anthropic or Google keys for more models, Tavily for web search, Upstash Redis for caching, and Vercel Blob for uploads in production.

Copy `.env.example` to `.env.local` and fill in at least `DATABASE_URL`, the Clerk keys, and `OPENAI_API_KEY`. The example file lists every variable with short notes.

## Run locally

```bash
pnpm install
cp .env.example .env.local
# edit .env.local with your keys
pnpm db:deploy
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), sign in, and send a message. If something fails, check that migrations ran and your keys are set correctly.

## Useful commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start the app locally |
| `pnpm build` | Production build |
| `pnpm lint` / `pnpm typecheck` | Catch errors |
| `pnpm test` | Unit tests |
| `pnpm db:migrate` | Create DB changes in development |
| `pnpm db:deploy` | Apply migrations (CI or production) |

## What you can do in the app

Chat with streaming replies, stop generation, regenerate an answer, or edit a message to open a new branch. Switch models from the composer. Upload images or PDFs. Use `/consensus` to ask several models the same question and get a combined answer. Open **Usage** to see recent token use. Share a chat with a public `/s/...` link that others can view but not edit.

## Deploy tip

On Vercel, add the same env vars, point `DATABASE_URL` at your production Postgres, and run `pnpm db:deploy` once. For uploads in production, set `BLOB_READ_WRITE_TOKEN`. Redis is optional — the app still runs without it.

That’s all you need to install, run, and ship SiroAI.
