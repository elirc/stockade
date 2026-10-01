// Entry point: dialog lifecycle guards, boot, and the 30-second poll. The
// behavior lives in the modules this imports:
//
//   api.js      — the one fetch wrapper (same-origin JSON + account intent)
//   state.js    — application state, cart persistence, identity tokens
//   dom.js      — markup helpers, formatting, escaping, toast
//   session.js  — refresh/reconciliation, login screen, business switching
//   views.js    — workspace shell and catalog/inventory/orders/activity views
//   cart.js     — cart edits and checkout with key recovery
//   dialogs.js  — the shared dialog: order actions, product and stock forms
import { api } from "./api.js";
import { $, escape, toast } from "./dom.js";
import { restoreCart, state, tokens } from "./state.js";
import { refresh, renderLogin } from "./session.js";
import { render } from "./views.js";
import { closeDialog } from "./dialogs.js";

$("#dialog").addEventListener("click", (event) => {
  if (event.target === $("#dialog")) {
    const rect = event.target.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      closeDialog();
  }
});
// "cancel" fires on Escape: closeDialog refuses while a write is pending, so
// the eventual response cannot land in a dialog reopened for something else.
$("#dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDialog();
});
$("#dialog").addEventListener("close", () => {
  tokens.dialogEpoch++;
});

async function boot() {
  try {
    state.accounts = (await api("/demo-accounts")).accounts;
    try {
      state.account = (await api("/session")).account;
    } catch (error) {
      if (error.status !== 401) throw error;
    }
    if (state.account) {
      restoreCart();
      await refresh();
    }
    render();
  } catch (error) {
    $("#app").innerHTML =
      `<main class="loading"><h1>Stockade is taking a moment.</h1><p>${escape(error.message)}</p><button class="primary" id="retry">Try again</button></main>`;
    $("#retry").onclick = boot;
  }
}
await boot();

// Polling is a reader, never a writer. It stays quiet while any operation or
// dialog is active or a form control is focused, and refresh() discards its
// data when a newer load or an account change has happened meanwhile.
setInterval(async () => {
  if (
    !state.account ||
    state.pending ||
    tokens.switchBusy ||
    tokens.loginBusy ||
    $("#dialog").open ||
    document.activeElement?.matches("input,textarea,select")
  )
    return;
  const epoch = tokens.accountEpoch;
  try {
    if (await refresh()) render();
  } catch (error) {
    if (epoch !== tokens.accountEpoch) return;
    if (error.status === 401) {
      tokens.accountEpoch++;
      state.account = null;
      renderLogin();
      toast("Demo session expired. Choose a business to continue.");
    }
  }
}, 30000);
