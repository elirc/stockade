# Operations
## Startup
Start Docker services and wait for PostgreSQL health before Fulfil. Inspect docker compose logs postgres during recovery; do not delete volumes. Schema initialization uses an advisory lock, transactional initial schema and version markers. Restarting must not reseed existing merchants.

## Upgrade and backup
Take a pg_dump custom-format backup and preserve the Data Protection key ring and configuration secrets. Rehearse restoration into a newly named database. Apply migrations once, restart twice, inspect schema_versions and reconcile. Do not restore inventory independently of newer payment history. An application rollback must remain compatible with the upgraded schema.

Use a migration owner for DDL and least-privilege runtime database users. The local shared account is a development convenience, not a production authorization boundary.

## Unknown payment or refund
Find order/provider IDs, states, attempts and trace ID. Retrieve authoritative test-provider state. Never release stock or create a second refund merely because a request timed out. Retry the existing durable workflow after fixing configuration/network causes. Retain pending refund capacity until the original provider outcome is known. Record the incident and reconciliation result.

## Dead letters
Inspect activity/health; repair the mail or HTTPS endpoint and retry the existing event. Subscribers deduplicate Stockade-Event-Id. Revoking a webhook prevents future sends, including queued deliveries checked at send time. Do not expose secrets in logs.

## Warehouse outage and shortages
Offline warehouses are excluded from new allocation. Existing held stock requires explicit reallocation or resolution. A count below committed stock must not force negative availability: investigate commitments, resolve/reallocate them safely, then recount. Preserve rejected observations and append-only history.

## Release gate
Require final builds/tests, migration/restart/restore evidence, tenant/role/scope checks, actual test-mode Stripe challenge/capture/refund cases, delivery/crash drills, measured load reports, independent review and separate human explain-back. Obtain authorization for public deployment, live financial effects and supplier communication.

## Code anchors for these procedures

- Schema initialization runs in one transaction and records versions in `schema_versions`
  (`services/Fulfil/Data/Migrations.cs:8`, `:15`, `:29`).
- The background worker ticks every 1.5 s (`services/Fulfil/Services/Worker.cs:34`) and, per tick, processes up to
  20 payment sagas, 20 pending refunds, expiry (50 orders), 20 outbox events, then due reconciliation
  (`Worker.cs:24-30`, `:157`, `:172`). Each item is guarded by a Postgres advisory lease (`Worker.cs:37-40`).
- Payment retries back off: an unknown outcome increments `Attempts` and pushes `UpdatedAt` forward by
  `min(120, attempts * 5)` seconds (`Worker.cs:125`); the saga query skips rows touched in the last 2 s and stops
  at 12 attempts (`Worker.cs:24`).
- **Refund retries do not back off.** A failed provider refund only increments `Attempts` (`Worker.cs:150`), and
  the refund query has no time filter or ordering (`Worker.cs:26`). A persistently failing refund therefore uses
  its 12 automatic attempts within roughly 12 ticks (about 18 s) and then stays `pending` with no further
  automatic retry. It shows up as "Refunds needing retry" on the health panel (`ReadApi.cs:73`); the authorized
  `refund.retry` command resets `Attempts` to 0 and requires a reason (`services/Fulfil/Services/Team.cs:32-36`).
  Fix the provider/configuration cause *before* retrying, or the next 12 attempts are spent just as fast.
- Dead-letter retry: `outbox.retry` accepts only `dead` events and resets them to pending
  (`services/Fulfil/Services/Commerce.cs:322`).
