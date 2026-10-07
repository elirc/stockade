# Security review
Boundaries: browser -> Next -> Fulfil -> PostgreSQL, and Fulfil -> provider/SMTP/webhook recipients. Browser prices, role, merchant, stock and payment state are untrusted.

Controls: HttpOnly SameSite session cookies, production Secure cookies, origin checks, database-backed account lookup, tenant/warehouse authorization, parameterized SQL, bounded inputs, login rate limits, financial/inventory CHECK constraints, immutable history triggers, durable idempotency, scoped hashed API keys, encrypted webhook secrets, HMAC timestamp validation and public-IP-pinned HTTPS delivery without redirects.

Keep API keys in trusted server secret storage, never browser bundles or NEXT_PUBLIC variables. Creation returns a secret once. After an uncertain creation response, inspect and revoke the orphan before replacing it. Preserve and protect the Data Protection key ring across restarts/replicas.

External review still required for verified identity/promotion abuse, account and guest-session recovery, invitations/password resets, retention/redaction, host TLS/CSP/proxy configuration, hostile-traffic limits, database least privilege and provider failure coverage. Local demo credentials and seeds must remain local.

Review tests must include foreign merchant/warehouse IDs, lower-role writes, tampered totals, negative/fractional/oversized quantities, duplicate and reordered provider events, concurrent refunds, private-IP/DNS-rebinding webhook destinations, expired signatures and key revocation. This checklist is not a claim those checks passed.

## Where the controls live (verified against this clone)

| Control | Code |
| --- | --- |
| Mutations need a trusted origin unless they are cookie-less Bearer calls or the Stripe callback | `services/Fulfil/Program.cs:53` |
| Login rate limit: 30 per minute per remote IP, no queue | `Program.cs:34-37` (policy `login`) |
| Scopes and API-key scope mapping per path/operation | `services/Fulfil/Services/Integrations.cs:15`, `:80-86` |
| API keys stored as SHA-256 hashes; tokens over 150 chars rejected | `Integrations.cs:16`, `AuthenticateKey` (line 66 onward); unique index on `KeyHash` in `Data/Migrations.cs` |
| Webhook URL: HTTPS, port 443, no user-info or fragment | `Integrations.cs:25-30` (`Destination`) |
| Public-IP pinning: every resolved address must be public; connect to the validated address without a second DNS lookup; no redirects, no proxy | `Integrations.cs:44-53` |
| Outbound signature `t=…,v1=hex(HMAC-SHA256(secret, t + "." + body))` | `Integrations.cs:17`, `:61` |
| Inbound verification: ±300 s window, constant-time compare | `Integrations.cs:18-24` |
| Webhook secrets encrypted with Data Protection (`stockade.webhooks.v1`) | `Integrations.cs:59` |
| Revocation checked at send time | `services/Fulfil/Services/Worker.cs:182-184` (`subscription?.Active == true`) |

Review note: the webhook connector pins `addresses[0]` after checking that *all* resolved addresses are public
(`Integrations.cs:48-51`), which closes DNS-rebinding between check and connect. It does not try the other
addresses if the first is unreachable, so a multi-address host with one dead address fails delivery and relies on
outbox retry.

**Check:** for each "Review tests must include" item above, name the test in `tests/` that covers it, or mark it
uncovered. Several (DNS rebinding, concurrent refunds) have no automated test in this repository.
