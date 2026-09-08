# Performance protocol v1
Targets remain hypotheses: 5,000 simultaneous one-unit attempts, 20 hot variants with 100 total units each (25 in each of four warehouses), 3 million historical orders, 200,000 variants, two application instances and one PostgreSQL instance. Successful full-checkout p95 <800ms; admin order-list p95 <300ms; zero oversells.

scripts/benchmark.mjs refuses databases not ending in _bench. Provision an isolated database, point the API instances to it, start Development seed, set DATABASE_URL and BENCH_API_URLS, then BENCH_SEED=1 for the first run. The historical fixture is synthetic closed orders for query workload; it is not a reconstructed business history. Save a clean benchmark snapshot before demand. Restore that snapshot to a fresh benchmark database for each repeat; the script refuses depleted hot stock.

Protocol: no ramp, one simultaneous burst, uniform hot-SKU distribution, local deterministic success simulator, 20 warm order-list reads and 100 measured page-1?20 reads during the burst. Observe asynchronous acceptance separately from final captured state (one-second completion sampling is an upper bound). Completion timeout is ten minutes and counts as failure, not a successful sample. Report sold-out responses separately from application/network failures.

Before running the full acceptance job, pin CPU/RAM/container limits, record Next/API/worker placement and collect CPU/RSS/I/O consumption. The two-instance budget must include Next and workers, not hide extra application servers. This repository's default local run is not that acceptance environment. Run the smaller 500/100 correctness test in CI; a small test cannot satisfy this workload.

Reservation-expiry target for a dedicated drill: <10 seconds after the 15-minute TTL for never-attempted reservations under idle local conditions. Pause workers, create pending stock, set a test-only expiry in the isolated database, resume and record release timestamp/owner state. Unknown provider effects retain stock and require a separate reconciliation measure.

No full-workload performance target is marked passed without a recorded execution, fixed resource envelope, consumption measurements and expiry drill. Stripe integration runs separately and must never receive this load burst.

Connection budget: the sample .NET connection string caps each pool at 16. EF and dedicated advisory-lock connections can use separate pools; account for both, each application replica, Next catalog pools and operational clients against PostgreSQL max_connections. Admission queues callers before they consume a lock connection. Queue time remains part of checkout acceptance latency and is never removed from the benchmark.
