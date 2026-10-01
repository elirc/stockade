// The shared <dialog>: lifecycle guards, the order detail with its state
// actions, and the product-create and stock-adjust forms.
import { api } from "./api.js";
import { $, date, escape, label, money, toast } from "./dom.js";
import { state, tokens } from "./state.js";
import { refresh } from "./session.js";
import { render } from "./views.js";

// While a write is pending the dialog cannot close or be repurposed, so the
// eventual response always lands in the dialog that sent it. Every open or
// close bumps dialogEpoch, invalidating any order read still in flight.
export function closeDialog() {
  if (tokens.dialogBusy) return;
  tokens.dialogEpoch++;
  $("#dialog").close();
}

export function setDialogBusy(value) {
  tokens.dialogBusy = value;
  $("#dialog")
    .querySelectorAll("button,input,textarea,select")
    .forEach((control) => (control.disabled = value));
}

export function openDialog(html) {
  if (tokens.dialogBusy) return;
  tokens.dialogEpoch++;
  const dialog = $("#dialog");
  dialog.innerHTML = html;
  dialog.querySelector("[data-close]")?.addEventListener("click", closeDialog);
  if (!dialog.open) dialog.showModal();
}

function dialogHead(title) {
  return `<div class="dialog-head"><h2>${escape(title)}</h2><button class="close" data-close aria-label="Close dialog">×</button></div>`;
}

export async function showOrder(orderId) {
  if (tokens.dialogBusy || tokens.switchBusy) return;
  const request = ++tokens.dialogEpoch,
    epoch = tokens.accountEpoch;
  try {
    const { order, events } = await api(`/orders/${orderId}`);
    if (request !== tokens.dialogEpoch || epoch !== tokens.accountEpoch) return;
    const status = order.status;
    openDialog(
      `${dialogHead(order.number)}<div class="order-meta"><div><span class="status ${status}">${label(status)}</span><br>Created ${date(order.createdAt)}</div><div>${status === "reserved" ? `Reservation expires<br><strong>${date(order.expiresAt)}</strong>` : "Local simulated commerce"}</div></div><div class="order-items">${order.items.map((item) => `<div><span>${escape(item.name)}<br><small>${item.quantity} × ${money(item.unitPriceCents)} · ${escape(item.sku)}</small></span><strong>${money(item.lineTotalCents)}</strong></div>`).join("")}<div><strong>Order total</strong><strong>${money(order.totalCents)}</strong></div></div><div class="message">All payments and refunds are simulated locally. No card is collected and no real money moves.</div>${status === "shipped" ? '<label class="checkbox"><input id="restock" type="checkbox" checked> Restock returned items with this refund</label>' : ""}<div class="order-actions">${status === "reserved" ? '<button class="primary" data-action="pay" data-outcome="approved">Simulate approved payment</button><button class="secondary" data-action="pay" data-outcome="declined">Simulate decline</button><button class="secondary danger" data-action="cancel">Cancel order</button>' : status === "paid" ? '<button class="primary" data-action="ship">Mark as shipped</button>' : status === "shipped" ? '<button class="primary" data-action="refund">Simulate full refund</button>' : `<p class="subtitle">${status === "refunded" ? `Refund complete. Items ${order.restocked ? "were returned to stock" : "were not restocked"}.` : "This order is closed. Its reservation has been released."}</p>`}</div><div id="order-error"></div><h3>Order timeline</h3>${events.map((event) => `<div class="activity-row"><span class="activity-dot"></span><div><strong>${escape(event.detail)}</strong><small>${date(event.createdAt)}</small></div></div>`).join("")}`,
    );
    document.querySelectorAll("[data-action]").forEach(
      (button) =>
        (button.onclick = async () => {
          if (tokens.dialogBusy) return;
          const action = button.dataset.action,
            body =
              action === "pay"
                ? { outcome: button.dataset.outcome }
                : action === "refund"
                  ? { restock: $("#restock").checked }
                  : {};
          setDialogBusy(true);
          try {
            await api(`/orders/${orderId}/${action}`, body);
            await refresh();
            render();
            setDialogBusy(false);
            await showOrder(orderId);
            toast("Order updated. Inventory and activity saved together.");
          } catch (error) {
            await refresh().catch(() => {});
            render();
            setDialogBusy(false);
            await showOrder(orderId);
            const box = $("#order-error");
            if (box)
              box.innerHTML = `<div class="message error" role="alert">${escape(error.message)}</div>`;
          }
        }),
    );
  } catch (error) {
    toast(error.message);
  }
}

export function productForm() {
  if (tokens.dialogBusy || tokens.switchBusy) return;
  openDialog(
    `${dialogHead("A new good thing.")}<p class="subtitle">Add a product and its opening inventory.</p><form id="product-form"><div class="form-grid"><label class="full">Product name<input name="name" maxlength="120" required></label><label>SKU<input name="sku" pattern="[A-Z0-9-]{2,32}" maxlength="32" placeholder="NS-PRODUCT" required></label><label>Price (USD)<input name="price" type="number" step="0.01" min="0.01" max="1000000" required></label><label>Opening units<input name="stock" type="number" step="1" min="0" max="1000000000" value="0" required></label><label class="full">Description<textarea name="description" maxlength="4000"></textarea></label></div><div id="form-error"></div><div class="form-actions"><button type="submit" class="primary">Create product</button></div></form>`,
  );
  $("#product-form").onsubmit = async (event) => {
    event.preventDefault();
    if (tokens.dialogBusy) return;
    const form = event.target,
      fields = new FormData(form);
    setDialogBusy(true);
    try {
      await api("/products", {
        name: fields.get("name"),
        sku: fields.get("sku"),
        priceCents: Math.round(Number(fields.get("price")) * 100),
        onHand: Number(fields.get("stock")),
        description: fields.get("description"),
      });
      await refresh();
      render();
      setDialogBusy(false);
      closeDialog();
      toast("Product created. Opening stock recorded.");
    } catch (error) {
      $("#form-error").innerHTML =
        `<div class="message error" role="alert">${escape(error.message)}</div>`;
      setDialogBusy(false);
    }
  };
}

export function stockForm(productId) {
  if (tokens.dialogBusy || tokens.switchBusy) return;
  const product = state.products.find((x) => x.id === productId);
  openDialog(
    `${dialogHead("Adjust stock")}<h3>${escape(product.name)}</h3><p class="subtitle">${escape(product.sku)} · ${product.onHand} on hand · ${product.reserved} reserved · Version ${product.version}</p><form id="stock-form"><div class="message">Use a positive number to receive stock or a negative number to remove it. Reserved units cannot be removed.</div><div class="form-grid"><label>Change in units<input name="delta" type="number" step="1" min="-1000000000" max="1000000000" placeholder="e.g. 12 or -3" required></label><label class="full">Reason<textarea name="reason" maxlength="300" placeholder="e.g. New shipment received" required></textarea></label></div><div id="form-error"></div><div class="form-actions"><button type="submit" class="primary">Save adjustment</button></div></form>`,
  );
  // The version captured when the form opened is the write's precondition. On
  // VERSION_CONFLICT the form keeps the operator's delta/reason but adopts the
  // server's current version, forcing a review before the retry can succeed.
  let version = product.version;
  $("#stock-form").onsubmit = async (event) => {
    event.preventDefault();
    if (tokens.dialogBusy) return;
    const form = event.target,
      fields = new FormData(form);
    setDialogBusy(true);
    try {
      await api(
        `/products/${productId}/stock`,
        {
          version,
          delta: Number(fields.get("delta")),
          reason: fields.get("reason"),
        },
        "PATCH",
      );
      await refresh();
      render();
      setDialogBusy(false);
      closeDialog();
      toast("Stock adjusted. Reason saved to the ledger.");
    } catch (error) {
      if (error.code === "VERSION_CONFLICT" && error.current) {
        version = error.current.version;
        $("#form-error").innerHTML =
          `<div class="message error" role="alert">Stock changed while you were editing. Current: ${error.current.onHand} on hand, ${error.current.reserved} reserved, ${error.current.available} available (v${version}). Review your change and save again.</div>`;
      } else
        $("#form-error").innerHTML =
          `<div class="message error" role="alert">${escape(error.message)}</div>`;
      setDialogBusy(false);
    }
  };
}
