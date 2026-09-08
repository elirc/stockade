# Learning and session evidence template

Copy this file for each meaningful ticket or learning session. Leave unknowns explicit. If you copy this template outside AstraDocs, update its relative links. Suggested filename: YYYY-MM-DD-S2-ticket-name.md. Store logs in a personal learning folder or a reviewed repository documentation location; do not include credentials or customer data.

## Session state

| Field | Your record |
|---|---|
| Date and learner | |
| Stockade milestone / roadmap stage | |
| Epic, story and ticket IDs | |
| Problem and intended user-visible behavior | |
| Source revision, patch ID or saved snapshot | |
| Current files/dirty changes | |
| Planned mode: SOLO / PAIR / DELEGATE / SPIKE | |
| Planned estimate range and SOLO allocation | |
| Actual time by mode | |
| Weakest competency addressed | |
| Status: Not started / Attempted / Remediated / Demonstrated | |
| Next action and blocker owner | |

Do not invent a Git revision if the workspace is not versioned. Link a saved snapshot or exact patch until a real revision exists. Planning estimates and actual hours are separate records.

## Plan and prediction, before implementation

- What user outcome am I changing or investigating?
- What are the Given/When/Then acceptance criteria and non-goals?
- Which service owns the behavior?
- Which stock, money, tenant, workflow and event invariants apply?
- What should the initial and final persisted records show?
- What failure would disprove my approach?
- Which two designs did I consider, and why is my chosen slice smaller or safer?
- What evidence will establish success, and what will remain unproven?

## Evidence ledger

| Experiment / command | Initial facts and prediction | Observed outcome / artifact | What it proves and does not prove |
|---|---|---|---|
| | | | |

Record failed runs as well as passes. A screenshot proves visible state; an HTTP 200 proves an accepted response; neither automatically proves financial completion or ledger consistency. For performance, include the workload, resource envelope, all outcome categories, queue time and treatment of timeouts.

## Assistance and escalation

| Time | Mode | Exact help received or requested | Work attributable to me | Remaining uncertainty |
|---|---|---|---|---|
| | | | | |

At 45 minutes without meaningful progress, record attempts, their evidence and a specific question. Log an explicit mode change before escalating. Agent-written portions remain assisted/delegated; they do not become SOLO because you later read them.

## Explain-back

Explain without reading a prepared answer:

1. The request path and relevant transaction boundaries.
2. The most important invariant and the mechanism that enforces it.
3. One realistic race or crash, including the durable recovery identity.
4. Why the test would detect the original defect.
5. A rejected alternative and when it might become reasonable.
6. What I still cannot establish from this evidence.

## Review and remediation

| Finding / reviewer | Severity and evidence | Resolution / artifact | Rechecked outcome |
|---|---|---|---|
| | | | |

Record whether the reviewer authored the work. A self-review, an automated test and an independent review are different evidence.

## Skill assessment

Use the [roadmap rubric](SWE_ROADMAP.md). Do not assign a score without an artifact.

| Competency | Before | After | Evidence and next unfamiliar variation |
|---|---|---|---|
| TypeScript / UI | Unassessed | | |
| C# / domain modeling | Unassessed | | |
| SQL / concurrency | Unassessed | | |
| Payment / distributed recovery | Unassessed | | |
| Testing / debugging | Unassessed | | |
| Security / authorization | Unassessed | | |
| Performance / operations | Unassessed | | |
| Product scoping | Unassessed | | |
| Technical communication | Unassessed | | |

## Short PR or portfolio record

**Problem and result:** Describe the concrete trigger, previous behavior and resulting behavior in one paragraph.

**Validation:** Link relevant checks and describe their practical limits.

**Tradeoff or open issue:** State any material limitation and the next action.

**Ownership:** State what you authored, what was assisted, and what review occurred.

## Resume here

- Current milestone, ticket and mode:
- Last verified artifact:
- Failed hypothesis or unresolved concern:
- Next smallest discriminating action:
- Required external input, if any:
- Files/docs that must be updated after the next change:
