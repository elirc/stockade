// Session and business identity: data refresh with identity reconciliation,
// the login screen, and switching businesses.
import { api } from "./api.js";
import { $, brand, escape, toast } from "./dom.js";
import { restoreCart, state, tokens } from "./state.js";
import { render } from "./views.js";
import { closeDialog } from "./dialogs.js";

// Returns true only when this (still-newest) refresh loaded data for the
// account the tab displays. The session is checked before AND after the data
// batch: the cookie is shared across tabs, so another tab can switch the
// server identity mid-batch, and data read under the wrong identity must be
// discarded by reload, never rendered under this tab's branding.
export async function refresh() {
  const epoch = tokens.accountEpoch,
    sequence = ++tokens.refreshSequence,
    displayedAccount = state.account?.id;
  const session = await api("/session");
  if (
    epoch !== tokens.accountEpoch ||
    sequence !== tokens.refreshSequence ||
    !state.account
  )
    return false;
  if (session.account.id !== displayedAccount) {
    location.reload();
    return false;
  }
  const [products, orders, summary, events] = await Promise.all([
    api("/products"),
    api("/orders"),
    api("/summary"),
    api("/activity"),
  ]);
  const verified = await api("/session");
  if (
    epoch !== tokens.accountEpoch ||
    sequence !== tokens.refreshSequence ||
    !state.account
  )
    return false;
  if (verified.account.id !== displayedAccount) {
    location.reload();
    return false;
  }
  state.products = products.products;
  state.orders = orders.orders;
  state.summary = summary;
  state.events = events.events;
  return true;
}

export function renderLogin() {
  $("#app").innerHTML =
    `<main class="login"><section class="login-story">${brand}<div class="eyebrow">A little order. A lot of possibility.</div><h1>Good things,<br>well managed.</h1><p>A thoughtful home for your products, inventory, and every order in between.</p></section><section class="login-choice"><div class="eyebrow">Your local workspace</div><h2>Welcome to Stockade.</h2><p class="subtitle">Choose a demo business to explore its catalog and operations.</p>${state.accounts
      .map(
        (account) =>
          `<button class="account-button" data-login="${account.id}"><span class="avatar">${escape(
            account.businessName
              .split(" ")
              .map((x) => x[0])
              .join(""),
          )}</span><span><strong>${escape(account.businessName)}</strong><small>${escape(account.name)} · Demo operator</small></span><span class="arrow">↗</span></button>`,
      )
      .join(
        "",
      )}<div class="message"><strong>Local commerce simulator</strong><br>These passwordless demo accounts are not production authentication. All payments and refunds are simulated. No real money, email, or external services.</div><p class="subtitle">Two separate businesses. One considered workspace.</p></section></main>`;
  document.querySelectorAll("[data-login]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (tokens.loginBusy || tokens.switchBusy) return;
      tokens.loginBusy = true;
      tokens.accountEpoch++;
      document
        .querySelectorAll("[data-login]")
        .forEach((x) => (x.disabled = true));
      try {
        state.account = (
          await api("/session", { accountId: Number(button.dataset.login) })
        ).account;
        restoreCart();
        await refresh();
        render();
      } catch (error) {
        toast(error.message);
        document
          .querySelectorAll("[data-login]")
          .forEach((x) => (x.disabled = false));
      } finally {
        tokens.loginBusy = false;
      }
    }),
  );
}

export async function switchBusiness() {
  if (state.pending || tokens.dialogBusy || tokens.switchBusy) {
    toast(
      "Wait for the current operation to finish before switching businesses.",
    );
    return;
  }
  tokens.switchBusy = true;
  tokens.accountEpoch++;
  tokens.dialogEpoch++;
  try {
    await api("/session", {}, "DELETE");
    closeDialog();
    state.account = null;
    state.cart = [];
    state.checkoutKey = null;
    state.unresolved = false;
    state.view = "catalog";
    state.search = "";
    state.filter = "all";
    renderLogin();
  } catch (error) {
    toast(error.message);
  } finally {
    tokens.switchBusy = false;
  }
}
