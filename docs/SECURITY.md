# Security review
Boundaries: browser ? Next ? Fulfil ? PostgreSQL, and Fulfil ? provider/SMTP/webhook recipients. Browser prices, role, merchant, stock and payment state are untrusted.

Controls: HttpOnly SameSite session cookies, production Secure cookies, origin checks, database-backed account lookup, tenant/warehouse authorization, parameterized SQL, bounded inputs, login rate limits, financial/inventory CHECK constraints, immutable history triggers, durable idempotency, scoped hashed API keys, encrypted webhook secrets, HMAC timestamp validation and public-IP-pinned HTTPS delivery without redirects.

Keep API keys in trusted server secret storage, never browser bundles or NEXT_PUBLIC variables. Creation returns a secret once. After an uncertain creation response, inspect and revoke the orphan before replacing it. Preserve and protect the Data Protection key ring across restarts/replicas.

External review still required for verified identity/promotion abuse, account and guest-session recovery, invitations/password resets, retention/redaction, host TLS/CSP/proxy configuration, hostile-traffic limits, database least privilege and provider failure coverage. Local demo credentials and seeds must remain local.

Review tests must include foreign merchant/warehouse IDs, lower-role writes, tampered totals, negative/fractional/oversized quantities, duplicate and reordered provider events, concurrent refunds, private-IP/DNS-rebinding webhook destinations, expired signatures and key revocation. This checklist is not a claim those checks passed.
