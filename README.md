# Stockade
Multi-merchant order management with a Next.js storefront/admin, .NET Fulfil service and real PostgreSQL inventory. Phase 2 extends the ledger with transfers, purchasing, cycle counts, and customer returns/exchanges.

**Verification status:** production build, 27 backend tests, five frontend tests, 13 functional database checks and three isolated browser journeys passed. The 500-request contention gate remains unresolved after a client timeout; see [verification](docs/VERIFICATION.md). This is a local learning build, with release gates still open.

## AstraDocs handoff

Start with [AstraDocs](astradocs/README.md) for the full project summary, code walkthroughs, SWE learning roadmap, prioritized engineering next steps, and reusable learning log.

## Run locally
Prerequisites: Node 22+, .NET 10 SDK, Docker Desktop with Linux containers.
1. Copy .env.example to .env.local and run npm ci.
2. Run docker compose up -d postgres mailpit. Wait for PostgreSQL health.
3. In PowerShell: $env:ASPNETCORE_ENVIRONMENT='Development'; dotnet run --project services/Fulfil --no-launch-profile
4. In another terminal: npm run dev
5. Open http://127.0.0.1:3000; workspace /admin; customer orders /account; mail http://127.0.0.1:8025.

scripts/start.ps1 combines launch steps. The optional docker compose --profile full up --build runs both applications in containers.

Synthetic accounts use **Stockade-demo-2026!**:
- admin@northline.test and customer@northline.test
- admin@harbor.test and customer@harbor.test (separate merchant)

The simulator makes no real charges. Startup seeds four warehouses and eight variants for Northline, plus separate Harbor accounts, without fabricated sales. Place a checkout and wait for Captured before fulfillment.

## Try the workflows
Place a guest order; reload the persisted cart; fulfill part of a paid order; request, approve and receive a return. Create/approve/dispatch/partially receive a transfer. Create a supplier and purchase order, then receive part of it. Open a count, move stock and observe stale-count rejection. Use a second administrator to approve a fresh correction. Inspect activity, retry failed deliveries, and run reconciliation.

## Verify
- npm run typecheck
- npm test
- dotnet test tests/Fulfil.Tests/Fulfil.Tests.csproj
- npm run build
- npm run test:e2e (running web/API/database; installed Chrome)
- node scripts/integration.mjs (running API/database; synthetic fixtures)
- PowerShell: $env:RUN_CONTENTION='1'; node scripts/integration.mjs (500 attempts against 100 units)

Fixture scripts are for local synthetic databases, not live merchants. See docs/VERIFICATION.md for actual results; unexecuted checks are not passes.

## Read the project
- src/app: Next pages, catalog/cart and API proxy.
- src/components: storefront and merchant operations.
- services/Fulfil/Domain: entities, money and transitions.
- services/Fulfil/Services: commands, worker, provider adapters and reconciliation.
- services/Fulfil/Data: serializable transactions, schema versions and seed.
- tests and scripts: domain, browser and real-database checks.
- docs/PHASE_2_STORIES.md: product stories and acceptance criteria.
- docs/UPSKILLING.md: walkthroughs, exercises and assessment.
- docs/ARCHITECTURE.md and docs/RUNBOOK.md: decisions and operations.
- STOCKADE_MASTER_PROMPT.md: preserved specification and curriculum.

Stripe is restricted to test keys and requires your test credentials. Demo tax is a configurable flat teaching rule, not a jurisdictional tax service. Human competence, independent review, real merchant measures, elapsed production observation and production performance acceptance remain separate evidence requirements.

## Source-based improvement course

[Start the course](astraupskill/README.md). Follow merchant-scoped refund health, retry boundaries, presentation guidance, and PostgreSQL regression evidence.

## Local learning rebuild (October 2026)

A self-contained local rebuild of this project lives in [rebuild/](rebuild/README.md): an Express + SQLite commerce simulator centered on inventory conservation and idempotent checkout under two-process contention. Built through Astra/Sol adversarial review and expanded into part 2 of a three-project upskilling curriculum — see [CURRICULUM.md](CURRICULUM.md). It runs standalone (Node 22.16+, `npm ci && npm start` inside `rebuild/`) and is fully isolated from the main codebase in this repository.
