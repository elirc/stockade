> This is the curriculum overview for the three-project rebuild course, copied into this repository so links from [rebuild/](rebuild/README.md) resolve. The three parts live on GitHub as [elirc/gitjira](https://github.com/elirc/gitjira), [elirc/stockade](https://github.com/elirc/stockade), and [elirc/relay](https://github.com/elirc/relay), each under `rebuild/`.

# The rebuild curriculum: three systems, one course

Three local learning projects live in this repository, built on 1 October 2026
through Astra/Sol adversarial builds and expanded into a junior-to-senior
curriculum for CRUD web application development. Each asks one sharp question,
answers it with a runnable system, and proves the answer with tests you can
read, run, and break.

**Work them in this order.** Each project assumes the discipline the previous
one taught.

| # | Project | Central question | Core mechanisms |
|---|---------|------------------|-----------------|
| 1 | [gitjira-rebuild](https://github.com/elirc/gitjira/blob/main/rebuild/README.md) | Can two editors silently lose each other's work? | Optimistic concurrency (version compare-and-swap), authorization inside the transaction, atomic mutation+activity, browser request-identity tokens |
| 2 | [stockade-rebuild](rebuild/README.md) | Can two buyers be promised the same physical unit? | Inventory conservation (`onHand ≥ reserved ≥ 0`), idempotent checkout keys with intent fingerprints, two-process contention evidence, shared-cookie tab identity |
| 3 | [relay-rebuild](https://github.com/elirc/relay/blob/main/rebuild/README.md) | Can a workflow recover when the outside world accepted an effect the worker never checkpointed? | Immutable published versions, lease fencing, durable checkpoints, provider idempotency keys, the effect/checkpoint crash window |

## The thread that connects them

Every project is about giving each piece of async work an **owner with the
right lifetime**:

- GitJira: a row **version** owns what a write may replace; a request **token**
  owns what a response may update. Neither substitutes for the other.
- Stockade: a checkout **key** owns a purchase intent across lost responses,
  reloads, and tabs; a product **version** owns an operator adjustment; the
  **displayed account** owns a tab's writes even though tabs share cookies.
- Relay: a run **request key**, a worker **lease token**, and a provider
  **effect key** have three different lifetimes, and confusing any two of them
  breaks a different guarantee.

The deliberate boundary between projects 2 and 3: **Stockade can atomically
mutate its simulated order and inventory in one transaction. Relay
deliberately cannot** — its provider receipts live in a separate store, so no
transaction can span effect and checkpoint. That is why Relay needs a
different recovery contract (stable idempotency keys and a cooperating durable
provider) rather than a bigger transaction. Understanding why the Stockade
answer stops working at the Relay boundary is the single most important
takeaway of the course.

## How each project is organized

All three follow the same conventions:

- `README.md` — run, explore, verify; honest scope limits.
- `ARCHITECTURE.md` / `CONTRACT.md` — the boundaries and the API promises.
- `journal/READ-ME-FIRST.txt` — the factual build retrospective: real
  disagreements, real bugs, real fixes.
- `journal/VERIFICATION.md` + `journal/evidence/` — exact final results at
  their actual strength, with raw output and screenshots. Historical record;
  later additions are not written into it.
- `journal/reviews/` — each agent's explicit findings.
- `journal/diffs/` — the review findings reconstructed as study-able diffs
  (labeled reconstructions; pre-fix source was not preserved).
- Learning layer — every project has `journal/LEARNING-PATH.md` and
  `journal/ARCHITECTURE-CLINIC.md`; gitjira adds `CODE-TOUR.md` +
  `EXERCISES.md`, while stockade and relay add `USER-STORY-WALKTHROUGHS.md`
  (fictional, labeled as such) and `PRACTICE-WORKBOOK.md` with labs and answer
  guides.
- `journal/worked-examples/` — one break-the-guarantee experiment per project,
  actually performed once with real captured output (predict → one-line break →
  observe → restore), as a model for how to run and report your own.
- Verification is always the same three commands from the project folder:
  `npm run check`, `npm test`, `npm run test:browser`. Each project carries a
  `.github/workflows/ci.yml` that runs them when pushed as its own repository.

## Working method (applies to every exercise)

1. **Predict first.** Write down what you expect before reading the code or
   running the test. The learning is in the gap.
2. **Evidence at its actual strength.** "12 tests pass" and "lost updates are
   impossible" are different claims; say which one you have.
3. When using builder/reviewer/verifier agents: the builder gives two viable
   designs and the conditions under which its preferred one is wrong; the
   reviewer gives a concrete failure history (input, observed result, violated
   promise), never "improve validation"; the verifier turns each accepted
   objection into a test that fails before the fix. Rotate roles between
   exercises.
4. One boundary change at a time, so disagreements have a clear object.

## Suggested path through the course

1. **GitJira** — take the [code tour](https://github.com/elirc/gitjira/blob/main/rebuild/CODE-TOUR.md), then
   [exercises](https://github.com/elirc/gitjira/blob/main/rebuild/EXERCISES.md) Tier 1 (break the guarantees) and
   at least two Tier 2 extensions.
2. **Stockade** — follow its
   [learning path](rebuild/journal/LEARNING-PATH.md); the contention
   lab and the two-tab identity lab are the heart of it.
3. **Relay** — follow its
   [learning path](https://github.com/elirc/relay/blob/main/rebuild/journal/LEARNING-PATH.md); draw the
   two-database crash timeline before running the durability suite.
4. **Boundary-moving capstones** (pick one per project): GitJira → PostgreSQL
   port or real auth; Stockade → partial refunds or a migration; Relay →
   persisted wait deadlines or the local webhook adapter.

## Electives

Five existing projects carry companion upskilling courses in the same
discipline, each pointing the course's themes at a dimension the rebuilds
exclude:

- [elirc/lucasrouter](https://github.com/elirc/lucasrouter) (RouteIQ) —
  heuristic optimization behind a swappable API contract: what a dispatcher
  can honestly promise about a route produced by an algorithm you intend to
  replace, and how metrics and tests pin a contract rather than an
  implementation. Start at its `upskill/LEARNING-PATH.md`.
- [elirc/aral-tagalog-v2-v2](https://github.com/elirc/aral-tagalog-v2-v2)
  (Aral) — offline-first sync in a web+mobile monorepo: progress recorded on a
  phone with no network merging into a server account without loss or double
  counting. The outbox/reducer/sync path is the identity-and-idempotency
  theme on a new boundary. Start at its `upskilling/course/LEARNING-PATH.md`.
- [elirc/relay-upskilling](https://github.com/elirc/relay-upskilling) (Relay
  import platform) — resumable, duplicate-proof bulk import across a
  TypeScript↔C# process boundary: when a 50,000-row file half-imports and the
  process dies, what can the operator honestly be told? relay-rebuild's
  closest sibling, one process boundary wider. Start at its
  `upskilling/course/LEARNING-PATH.md`.
- [elirc/elihyper](https://github.com/elirc/elihyper) (HyperNova) — what
  "production" adds: when a real site ships through Plasmic codegen, AWS
  Amplify, and third-party tracking, which promises move out of your code,
  and how do you still verify them? Includes PR-history archaeology on its
  story-per-PR main branch. Start at its `upskill/LEARNING-PATH.md`.
- [elirc/bootlocalopusv2](https://github.com/elirc/bootlocalopusv2)
  (bootlocalopus) — the grading engine itself: running someone else's
  untrusted code and grading it honestly without the grader lying, hanging,
  or being forged. Its `upskilling/course/CAPSTONE-TRACK.md` also maps which
  of its 508 lessons are prerequisites for each rebuild, making it the course
  index for the whole programme. Start at its
  `upskilling/course/LEARNING-PATH.md`.

## Course capstone: one system that needs all three

When all three projects are done, design (then optionally build) the system
that forces their lessons to coexist: **order fulfillment as a workflow.** A
Stockade-style order, once paid, starts a Relay-style multi-step fulfillment
workflow (pick, pack, notify), while GitJira-style collaborative editing
governs the product catalog the order was priced from.

The design must answer, in writing, before any code:

1. Which facts live in one transaction and which cross a store boundary? (The
   payment keeps Stockade's rules; the notify step inherits Relay's
   effect/checkpoint gap.)
2. What is the identity table — every key, its lifetime, and its reuse
   semantics? There will be at least six distinct identities. Confusing any
   two is a concrete bug; name which bug.
3. Where does a version precondition suffice, and where does a lease become
   necessary? (A rule of thumb to test: versions guard *state*, leases guard
   *work in progress*.)
4. What is the failure matrix for "order paid but fulfillment never started,"
   and which store is authoritative for each cell?
5. What evidence would each promise need — which assertions, how many
   processes, which forced failures?

Review it with the builder/challenger/verifier protocol, one boundary at a
time. The design document, challenged and revised, is the deliverable; the
build is optional and large.

Everything runs locally on this laptop: Node 22.16+, Express, `node:sqlite`,
Playwright Chromium. No external service is contacted by any project.
