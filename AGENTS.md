# Stockade repository contract

Read STOCKADE_MASTER_PROMPT.md for the product and curriculum. The latest user request authorizes delegated implementation of both phases now; calibration, SOLO work, explain-back, and external review remain unassessed, not passed. See docs/CONTRACT_LOG.md.

- Next.js owns catalog/cart HTTP paths. Fulfil owns orders, inventory, payments, logistics, procurement, and returns. PostgreSQL is authoritative; no browser inventory ledger.
- Every mutation validates actor and merchant scope. Use transaction + idempotency receipt for commands and append-only stock/audit history. Never weaken a database invariant to pass a test.
- Commands: npm run typecheck; npm test; dotnet test tests/Fulfil.Tests; npm run build; npm run test:e2e. Integration tests require PostgreSQL.
- Keep the existing prompt. Do not commit secrets, generated dependencies, or local data.
- Report actual test results, limitations, and external dependencies. A simulator result is not a Stripe result. Never claim independent review or human understanding from agent implementation.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
