# Reconstructed diffs: the Stockade review fixes

**Provenance note.** The build did not preserve pre-fix source snapshots, so
these diffs are **reconstructions**: the post-fix side is real code from the
delivered build, and the pre-fix side is rebuilt from the behavior recorded in
[READ-ME-FIRST.txt](../READ-ME-FIRST.txt) §5, the agent reviews, and
[VERIFICATION.md](../VERIFICATION.md). They exist so a learner can study each
finding as a reviewable change — read the finding, cover the diff, write the
fix you would make, then compare. The exact pre-fix spelling may have differed;
the behavior did not.

---

## Fix 1 — The server must age sessions itself

**Observed (Sol, API tests):** the first session middleware accepted any
stored token without enforcing its lifetime. Browser cookie expiry is not
enforcement: a client can retain an old cookie and keep sending it manually.

```diff
   const session = token &&
-    db.prepare("SELECT account_id FROM sessions WHERE token_hash=?").get(hash(token));
-  if (!session)
+    db.prepare("SELECT account_id,created_at FROM sessions WHERE token_hash=?").get(hash(token));
+  if (
+    !session ||
+    !Number.isFinite(Date.parse(session.created_at)) ||
+    Date.parse(session.created_at) + 86400000 <= clock()
+  )
     fail(401, "UNAUTHENTICATED", "Choose a demo business to continue.");
```

**Why it matters:** the trust boundary is the server, so the lifetime check
must live there. Note the defensive `Number.isFinite` guard — a corrupt
timestamp fails *closed* (unauthenticated), not open. The regression test
inserts an old stored session directly and asserts 401. The same lesson was
carried forward into Relay's session middleware during its build.

---

## Fix 2 — The stale-tab precondition must also cover logout

**Observed (browser-reproduced, pre-fix):** tabs share cookies. Sol's
objection: switching the business in one tab changes the server identity of a
second tab whose screen still shows the old business. Root required every
browser write to carry the account the tab *displays*, rejected with 409 on
mismatch. But the first implementation registered the logout route **before**
that precondition middleware — a stale tab's "Switch business" action returned
**204 and revoked the session the user had just selected in the other tab**.

```diff
   app.get("/api/session", (req, res) => res.json({ account: req.account }));
-  app.delete("/api/session", (req, res) => {
-    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(tokenFrom(req)));
-    res.clearCookie("stockade_session", { httpOnly: true, sameSite: "strict", path: "/" });
-    res.status(204).end();
-  });
   // Optional browser write precondition prevents a stale tab from writing
   // under a newly switched cookie.
   app.use("/api", (req, res, next) => {
     if (
       req.get("X-Stockade-Account") !== undefined &&
       req.get("X-Stockade-Account") !== String(req.account.id)
     )
       fail(409, "ACCOUNT_CHANGED", "The demo business changed in another tab. Reload to continue.");
     next();
   });
+  app.delete("/api/session", (req, res) => {
+    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(tokenFrom(req)));
+    res.clearCookie("stockade_session", { httpOnly: true, sameSite: "strict", path: "/" });
+    res.status(204).end();
+  });
```

**Why it matters:** this is a pure *ordering* bug — every piece existed and
was individually correct; middleware registration order decided whether the
guarantee applied. The browser test observed 204 + wrong-session revocation
before the fix and 409 + preserved new session after it
([VERIFICATION.md](../VERIFICATION.md) records both observations). It is also
a clean example of the difference between **authorization** (the cookie's
session was genuinely allowed to log out) and **user intent** (the human was
looking at a different business).

---

## What to take from these as a learner

Both fixes defend the same idea at different layers: identity has a lifetime
and a display context, and neither the cookie jar nor the screen can be
trusted to agree with the server on their own. Lab 6 in
[PRACTICE-WORKBOOK.md](../PRACTICE-WORKBOOK.md) works through the two-tab
scenario; the shared-cookie race scenarios in
[tests/ui-races.mjs](../../tests/ui-races.mjs) pin the behavior.
