// All mutable client state lives here, including the request-identity tokens.
//
// The tokens answer one question: which in-flight response is still allowed
// to touch the screen? Each async load captures the current token before
// awaiting and compares it afterward; anything that invalidates the screen
// bumps the token so the stale response is discarded:
//
//   accountEpoch    — the signed-in business; bumped on login, switch, and
//                     401 handling so a slow response for the old account
//                     can never render under the new one
//   refreshSequence — the data refresh; bumped by every refresh() so only
//                     the newest load may write products/orders/summary
//   dialogEpoch     — the shared <dialog>; bumped on open/close so a delayed
//                     order read cannot populate a dialog since repurposed
//
// The busy flags (dialogBusy, loginBusy, switchBusy) lock the UI while a
// write is pending, so its eventual response lands in the context that sent
// it. These remedies carried over from GitJira after root's UI source review
// (journal/reviews/sol-ui.md, journal/READ-ME-FIRST.txt section 5).
import { toast } from "./dom.js";

export const state = {
  account: null,
  accounts: [],
  products: [],
  orders: [],
  summary: {},
  events: [],
  view: "catalog",
  search: "",
  filter: "all",
  cart: [],
  checkoutKey: null,
  pending: false,
  unresolved: false,
};

export const tokens = {
  accountEpoch: 0,
  refreshSequence: 0,
  dialogEpoch: 0,
  dialogBusy: false,
  loginBusy: false,
  switchBusy: false,
};

// The persisted checkout key is the only reliable link to an order the server
// may already have committed when the response was lost. While a checkout is
// unresolved, the key and its exact cart are restored together (per account),
// so a reload can replay the same intent instead of reserving stock twice —
// losing the key here would lose that recovery (journal/READ-ME-FIRST.txt §3).
export function restoreCart() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`stockade-cart-${state.account.id}`) || "{}",
    );
    state.cart = Array.isArray(saved.cart)
      ? saved.cart
          .filter(
            (x) =>
              Number.isSafeInteger(x.productId) &&
              Number.isSafeInteger(x.quantity) &&
              x.quantity > 0 &&
              x.quantity <= 1000,
          )
          .slice(0, 20)
      : [];
    state.checkoutKey =
      typeof saved.checkoutKey === "string" ? saved.checkoutKey : null;
    state.unresolved = Boolean(
      saved.unresolved && state.checkoutKey && state.cart.length,
    );
  } catch {
    state.cart = [];
    state.checkoutKey = null;
    state.unresolved = false;
  }
}

export function saveCart() {
  try {
    localStorage.setItem(
      `stockade-cart-${state.account.id}`,
      JSON.stringify({
        cart: state.cart,
        checkoutKey: state.checkoutKey,
        unresolved: state.unresolved,
      }),
    );
  } catch {
    toast(
      "Browser storage is unavailable. Keep this tab open to recover an uncertain checkout.",
    );
  }
}
