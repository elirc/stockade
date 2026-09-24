# Compare — your review vs. the sealed answer

Fill this in **after** you've written your own findings list and only then opened `training/_answers/review.md`.

## 1. What did you find that the answer also found?

(List matches. These are your strengths — note *why* you caught them, so you can repeat the technique.)

## 2. What did the answer find that you missed?

For each miss, answer honestly:
- Did you not read that file/method at all, or read it and not see it?
- Was it a category you don't usually check (e.g. "what happens on crash between two commits" vs. "is this
  SQL injectable")?
- Would a checklist item have caught it? What would that checklist item say?

## 3. What did you find that the answer didn't?

(Keep these — they may be genuinely valid. Not everything in a real review has to already be in someone's
notes. If you're unsure whether a finding is real, write down how you'd prove it, e.g. "write a test that
kills the Worker between the two `tx.Run` calls in the void_pending branch and assert the order recovers.")

## 4. The pattern behind your misses

One or two sentences: what's the *general* skill gap behind what you missed this round (e.g. "I read command
handlers top-to-bottom but don't yet trace a saga across a crash/restart boundary" or "I check auth on writes
but not on background-job state transitions")? This is the thing to deliberately practice next, not just on
this project.
