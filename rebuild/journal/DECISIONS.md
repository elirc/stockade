# Decisions before implementation

These are explicit design rationales, recorded before final test results. They are not hidden model reasoning or a fictional transcript.

| Decision | Alternative considered | Reason and revisit condition |
|---|---|---|
| SQLite transactions serialize stock writers | Per-process JavaScript mutex | Two server processes must share the guarantee. An in-memory mutex cannot coordinate them. Revisit SQLite for sustained write throughput or multi-machine deployment. |
| Separate `onHand` and `reserved` | Decrement physical stock at checkout | Checkout holds stock; shipping physically consumes it. Expiry/cancellation release holds. Separate quantities make conservation visible. |
| Paid orders retain reservations | Release hold upon payment | Payment is not shipment. Releasing the hold would let another order buy already-paid stock. |
| Versioned inventory adjustments | Blind absolute stock replacement | An operator should not overwrite a concurrent reservation change with a stale count. A 409 requires reconciliation. |
| Durable key and request fingerprint | Client-side duplicate-click prevention | A lost response or another process can retry despite disabled buttons. The database must distinguish replay from changed intent. |
| Replays return same order identity in its current state | Freeze the original checkout response | The UI needs the current lifecycle. An old key must never reserve stock again, even after cancellation. This is documented replay semantics, not a claim of byte-identical responses. |
| Fake payment transition is in the local transaction | Integrate a real payment sandbox now | This rebuild isolates stock/state correctness. A remote provider introduces uncertain outcomes and reconciliation; Relay separately exercises an external-effect boundary. |

Initial Sol review requested inventory conservation, terminal-state guards, real two-process pressure, expiry races, and durable key semantics. Those concerns informed the contract and independent tests. Results and any revised decisions belong in the final narrative.
