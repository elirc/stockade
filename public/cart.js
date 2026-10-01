// Catalog cart and checkout, including recovery of an uncertain checkout.
import { api } from "./api.js";
import { $, escape, money, toast } from "./dom.js";
import { saveCart, state, tokens } from "./state.js";
import { refresh, renderLogin } from "./session.js";
import { render, renderResults } from "./views.js";
import { showOrder } from "./dialogs.js";

export function addCart(productId) {
  if (state.pending) return;
  // While a checkout outcome is unknown, the cart is frozen: editing it would
  // discard the saved key/cart pair, the only link to a possibly-committed
  // order (journal/READ-ME-FIRST.txt section 3).
  if (state.unresolved) {
    toast("Retry your unconfirmed checkout before changing the cart.");
    return;
  }
  const product = state.products.find((x) => x.id === productId),
    line = state.cart.find((x) => x.productId === productId);
  if ((line?.quantity || 0) >= Math.min(product.available, 1000)) {
    toast("All available units are already in your cart.");
    return;
  }
  if (!line && state.cart.length >= 20) {
    toast("A cart can contain at most 20 distinct products.");
    return;
  }
  if (line) line.quantity++;
  else state.cart.push({ productId, quantity: 1 });
  // A deliberate cart edit is a new intent, so it gets a new key; reusing the
  // old key with different items would be a 409 IDEMPOTENCY_CONFLICT.
  state.checkoutKey = null;
  saveCart();
  renderCart();
}

export function renderCart() {
  const cart = $("#cart");
  if (!cart) return;
  const lines = state.cart
    .map((line) => ({
      ...line,
      product: state.products.find((x) => x.id === line.productId),
    }))
    .filter((x) => x.product);
  const count = lines.reduce((n, x) => n + x.quantity, 0),
    total = lines.reduce((n, x) => n + x.quantity * x.product.priceCents, 0);
  cart.innerHTML = `<div class="cart"><div class="cart-head"><h2>Your order</h2><span>${count} ${count === 1 ? "item" : "items"}</span></div><div class="cart-body">${lines.length ? lines.map((line) => `<div class="cart-line"><div class="cart-line-top"><strong>${escape(line.product.name)}</strong><span>${money(line.product.priceCents * line.quantity)}</span></div><div class="cart-line-controls"><div class="quantity"><button data-quantity="${line.productId}" data-delta="-1" aria-label="Decrease ${escape(line.product.name)} quantity" ${state.pending ? "disabled" : ""}>−</button><span>${line.quantity}</span><button data-quantity="${line.productId}" data-delta="1" aria-label="Increase ${escape(line.product.name)} quantity" ${state.pending ? "disabled" : ""}>+</button></div><button class="link-button" data-remove="${line.productId}" ${state.pending ? "disabled" : ""}>Remove</button></div>${line.quantity > line.product.available ? '<p class="cart-hint">Stock changed. Reduce the quantity to continue.</p>' : ""}</div>`).join("") : '<div class="empty"><span class="empty-symbol">＋</span>A few good things.<br>Add a product to start your order.</div>'}<div class="cart-total"><span>Subtotal</span><strong>${money(total)}</strong></div><button class="primary wide" id="checkout" ${!lines.length || state.pending ? "disabled" : ""}>${state.pending ? "Reserving your order…" : "Reserve order"} &nbsp; ↗</button><p class="cart-hint">Stock is held after checkout.<br>Payment is always simulated.</p><div id="checkout-error"></div></div><div class="cart-foot">◇ &nbsp; Thoughtfully tracked.<br>Unpaid holds expire automatically. Paid orders keep their reservation until shipment.</div></div>`;
  document.querySelectorAll("[data-quantity]").forEach((button) => {
    button.disabled = state.pending || state.unresolved;
    button.onclick = () => {
      if (state.pending || state.unresolved) return;
      const productId = Number(button.dataset.quantity);
      if (button.dataset.delta === "1") {
        addCart(productId);
        return;
      }
      state.cart = state.cart
        .map((x) =>
          x.productId === productId ? { ...x, quantity: x.quantity - 1 } : x,
        )
        .filter((x) => x.quantity > 0);
      state.checkoutKey = null;
      saveCart();
      renderCart();
    };
  });
  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.disabled = state.pending || state.unresolved;
    button.onclick = () => {
      if (state.pending || state.unresolved) return;
      state.cart = state.cart.filter(
        (x) => x.productId !== Number(button.dataset.remove),
      );
      state.checkoutKey = null;
      saveCart();
      renderCart();
    };
  });
  if (state.unresolved && !state.pending) {
    $("#checkout").textContent = "Recover checkout ↗";
    $("#checkout-error").innerHTML =
      '<div class="message">Checkout is unconfirmed. Retry this saved cart to recover the same order before editing it.</div>';
  }
  document.querySelectorAll("[data-add]").forEach((button) => {
    button.disabled =
      state.pending ||
      state.unresolved ||
      state.products.find((p) => p.id === Number(button.dataset.add))
        ?.available === 0;
  });
  $("#checkout").onclick = checkout;
}

export async function checkout() {
  if (state.pending || !state.cart.length || tokens.switchBusy) return;
  state.pending = true;
  // The key and cart are persisted as unresolved BEFORE the request leaves,
  // so a lost response, reload, or crash can still replay the same intent and
  // recover the order the server may have committed. A key is minted only
  // once per intent (??=): the retry path reuses it.
  state.unresolved = true;
  state.checkoutKey ??= crypto.randomUUID();
  saveCart();
  renderCart();
  try {
    const result = await api("/checkouts", {
      idempotencyKey: state.checkoutKey,
      items: state.cart,
    });
    state.cart = [];
    state.checkoutKey = null;
    state.unresolved = false;
    saveCart();
    await refresh();
    state.pending = false;
    render();
    await showOrder(result.order.id);
    toast("Order recovered. No real payment collected.");
  } catch (error) {
    state.pending = false;
    // Only a definite client rejection (4xx other than 401) proves nothing
    // was committed; a 5xx or network failure keeps the key for recovery.
    if (error.status >= 400 && error.status < 500 && error.status !== 401) {
      state.unresolved = false;
      saveCart();
    }
    renderCart();
    const box = $("#checkout-error");
    if (box)
      box.innerHTML = `<div class="message error" role="alert">${escape(error.message)} ${state.unresolved ? "Your checkout key and cart are saved. Retry safely to recover the same order." : ""}</div>`;
    if (error.status === 401) {
      tokens.accountEpoch++;
      state.account = null;
      renderLogin();
    } else
      try {
        if (await refresh()) renderResults();
      } catch {}
  }
}
