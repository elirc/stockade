// The only place the browser talks to the server. Same-origin JSON; failures
// become Error objects carrying the HTTP status, error code, and (for 409s)
// the server's current copy of the contested row.
import { state } from "./state.js";

export async function api(path, body, method = "POST") {
  // Tabs share the session cookie, so the server's identity can differ from
  // the business this tab still displays. Every request states the displayed
  // account; the server rejects a mismatch with 409 ACCOUNT_CHANGED before
  // any business operation runs (journal/READ-ME-FIRST.txt section 5).
  const accountHeader = state.account
    ? { "X-Stockade-Account": String(state.account.id) }
    : {};
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? { headers: accountHeader }
      : {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Stockade-Request": "1",
            ...accountHeader,
          },
          body: JSON.stringify(body),
        },
  );
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    // A stale tab must not keep operating under another tab's identity:
    // reload discards this document's work and restores the matching account.
    if (data.code === "ACCOUNT_CHANGED") location.reload();
    const error = new Error(data.error || "The request failed.");
    error.status = response.status;
    error.code = data.code;
    error.current = data.current;
    throw error;
  }
  return data;
}
