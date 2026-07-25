# Technical debt (post verification close-out)

Last updated: 2026-07-25 (verification + close-out pass).

## Closed in this pass

- Soft-delete attachment/blob access (files routes require `notebook.deletedAt: null`)
- Share-token revoke when notebook is soft-deleted
- Dead-letter rescue ceiling (`MAX_DEAD_RESCUES=3`, `MAX_DEAD_AGE_MS=24h` → permanently failed)
- DEAD job visibility (`GET /api/admin/jobs/dead`, `pnpm jobs:dead`)
- Source upload errors route through `toSourceAppError` / `AppError`
- Hobby Cron reality: daily Vercel cron + aggressive `after()` + opportunistic poll drain + external scheduler docs

## Open — from Phase A findings (state plainly)

| Item | Severity | Notes |
|---|---|---|
| **Hobby Cron is daily-only** | Ops | Confirmed Hobby plan. Minute-level drain depends on `after()`, UI polling, and optional external scheduler hitting `/api/cron/jobs`. Upgrade to Pro if you want first-party minute Cron. |
| **Chat pipeline latency scales with OpenAI, not DB** | Perf | Authenticated service-level load (retrieve + `gpt-4o-mini`) held 0% errors through **40 concurrent**. P95 ≈ **2.8–4.9s**, P99 ≈ **3.1–4.9s**. No OpenAI 429s, no DB cliff in this run. Bottleneck is LLM/embed latency under concurrency, not Neon connections. |
| **HTTP `/api/chat` load still needs a Clerk cookie** | Test | `SESSION_COOKIE` + `CONVERSATION_ID` were not available this pass; pipeline mode measured the same core path. Re-run with a staging session before claiming HTTP rate-limit cliffs. |
| **`retrieveRelevantChunks` is not user-scoped** | Security (P0 awareness) | Callers (chat) must authorize. Adversarial suite documents the IDOR if a caller passes a foreign `notebookId`. Defense-in-depth user scoping still optional follow-up. |
| **Isolation suite is mostly service-layer** | Test (P1) | List/share/soft-delete covered in services; HTTP handlers for files/chat still thin. Prefer route-level tests over duplicated Prisma `where` clones. |
| **Plain `Error` remains in non-source modules** | Maintainability | Notebook/conversation/branch/share actions and fetch helpers still throw plain `Error`. API/action boundaries should keep mapping; migrate hot paths opportunistically. |
| **Production deploy lag** | Ops | Live `siro-ai-nu.vercel.app` returned **404** for `/api/ready`, `/api/cron/jobs`, `/api/admin/jobs/dead` during checklist (health/redis OK). Redeploy this branch before treating staging as production-equivalent. |

## Still true from earlier hardening

- Raise OpenAI rate limits before multi-thousand concurrent chat users
- Prefer dedicated workers only if queue lag grows under sustained load after external cron is in place
- Sentry + Supadata recommended in production env
