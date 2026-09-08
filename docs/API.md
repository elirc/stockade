# API v1
The local Fulfil base is http://127.0.0.1:5080/api/v1. The Next browser proxy is /api. Browser mutations require an authenticated HttpOnly cookie and trusted Origin; server clients use a Bearer key without cookies. API credentials are created/revoked in settings, require explicit scopes and are never returned by list endpoints.

Read endpoints: GET /data/orders, /orders/{id}, /data/inventory, /data/warehouses, /data/transfers, /data/purchases, /data/counts, /data/returns. Orders/inventory use bounded page/limit and q filters. The data response contains items and relevant totals.

Commands: POST /commands/{operation} with Content-Type application/json and Idempotency-Key. Use the typed inputs in src/lib/stockade-sdk.ts. For order.cancel, supply id and reason; the SDK requires the reason used by captured-order cancellation/refund handling. Persist the key before the request. Retry the identical operation/payload/key after an uncertain network result. A changed payload/key pair is a new intent; reusing a key with changed payload returns 409.

Errors contain code, error and, where available, traceId. 401 means invalid authentication; 403 scope/role/origin; 404 inaccessible/missing record; 409 state/concurrency conflict; 422 domain validation. Unexpected errors preserve a server trace without leaking implementation detail.

Cookie-only integration management: GET /integrations, POST /integrations/keys {name,scopes}, POST /integrations/webhooks {url}, POST /integrations/{keys|webhooks}/{id}/revoke. Creation returns the secret once and audit records exclude it. These create endpoints do not support command idempotency; after an uncertain response, inspect/revoke an orphan before recreating.

API scopes: orders:read, orders:write, inventory:read, inventory:write, returns:write, procurement:write. Keys cannot create accounts, change integration credentials, or check out as a customer.

Outbound envelope: id, type, createdAt, data. Stockade-Event-Id identifies the original event. Stockade-Signature uses t=UNIX_SECONDS,v1=hex(HMAC-SHA256(secret, timestamp + "." + exactBody)). Verify in constant time within five minutes and durably deduplicate event IDs before effects. At-least-once delivery is intentional.

Stripe callback: POST /stripe/webhook. Configure Payments:StripeWebhookSecret. Signature/replay validation precedes parsing and state lookup; live events are rejected. Signed events wake the worker, which retrieves authoritative provider state.
