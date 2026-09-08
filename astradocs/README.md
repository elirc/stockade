# AstraDocs: Stockade SWE handoff

Start here to understand the project, run it, and turn the implementation into independent software-engineering practice.

**Snapshot: 2026-09-08.** Stockade's core application and Phase 2 feature implementations are present. The recorded production build, 27 backend tests, five frontend tests, 13 functional database checks, and three isolated browser journeys passed. The 500-request contention acceptance **has not passed**. This is a local learning build with release gates still open.

These documents summarize repository evidence; they do not claim new application test runs, production readiness, independent review, or learner competence.

## Read in this order

| Document | What you get |
|---|---|
| [Project summary](PROJECT_SUMMARY.md) | Product scope, implemented features, architecture, invariants, tradeoffs, and verification limits |
| [Code walkthroughs](CODE_WALKTHROUGHS.md) | Concrete request paths, stock and money examples, and debugging entry points |
| [SWE roadmap](SWE_ROADMAP.md) | A staged learning program with exercises, deliverables, and assessment gates |
| [Next engineering steps](NEXT_STEPS.md) | Prioritized tickets, acceptance criteria, dependencies, and the release decision |
| [Learning log template](LEARNING_LOG_TEMPLATE.md) | A reusable record for predictions, assistance, experiments, review, and skill evidence |

## First working session

1. Read the project summary and [recorded verification](../docs/VERIFICATION.md).
2. Follow the [root setup guide](../README.md). Use the existing local services if they are already running; do not launch duplicate listeners.
3. Open [the storefront](http://127.0.0.1:3000), place a simulator checkout, and find the order in the merchant workspace.
4. Before fulfillment, predict the changes to onHand, reserved, held, and available. Compare your prediction with the actual stock and order records.
5. Copy the learning template to a dated file in a personal learning folder. Record one thing you can explain and one thing you cannot yet explain.
6. Begin ticket A-01 in the next-steps backlog: reproduce and instrument the unresolved contention failure.

Use 127.0.0.1 for this workstation. An unrelated application was observed on a localhost/IPv6 listener during the build. The root README contains the synthetic accounts and local-only demo password. Mailpit is at http://127.0.0.1:8025.

## How to interpret completion

- **Implemented:** code exists for a capability. This does not imply every edge case was tested.
- **Verified locally:** a named check ran and passed in the recorded environment.
- **Release-ready:** target performance, provider, recovery, security, and operational evidence are complete. Stockade has not reached this gate.
- **Demonstrated skill:** you explain, change, test, and defend unfamiliar behavior with recorded assistance and review. Current human assessment is unassessed.

The original [master prompt](../STOCKADE_MASTER_PROMPT.md) remains the product and mentorship contract. Its Phase 1 M0-M12 and Phase 2 M13-M18 milestones remain visible in the roadmap. The original [twelve feature stories](../docs/PHASE_2_STORIES.md) contain product acceptance criteria; new tickets here focus on learning and remaining engineering evidence.

## Maintaining this handoff

After a code change, update the affected explanation and link the actual test result. After a failed run, keep the failure visible until a comparable rerun passes. After a learning exercise, update your own log; do not convert the agent's implementation hours into SOLO hours. See [open release gates](../docs/OPEN_THREADS.md).


## Validation of this handoff
All six guides, 84 local links and the worked arithmetic were checked. The SDK cancellation reason type was corrected and the TypeScript check passed. Earlier application-suite results are carried-forward evidence; the unresolved contention test was not rerun or marked passed.
