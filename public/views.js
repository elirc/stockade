// Workspace shell and view rendering: sidebar, stats, catalog, inventory,
// orders, and the activity ledger.
import { api } from "./api.js";
import { $, brand, date, escape, icon, label, money, toast } from "./dom.js";
import { state } from "./state.js";
import { refresh, renderLogin, switchBusiness } from "./session.js";
import { addCart, renderCart } from "./cart.js";
import { showOrder, productForm, stockForm } from "./dialogs.js";

export function render() {
  if (!state.account) return renderLogin();
  $("#app").innerHTML =
    `<div class="shell"><aside class="sidebar">${brand}<div class="workspace-label">Workspace</div><nav class="nav" aria-label="Main navigation">${["catalog", "orders", "inventory", "activity"].map((view) => `<button data-view="${view}" aria-label="${label(view)}" class="${state.view === view ? "active" : ""}">${icon(view)}<span class="nav-label">${label(view)}</span>${view === "orders" ? `<span class="count">${state.summary.orderCount || 0}</span>` : ""}</button>`).join("")}</nav><div class="sidebar-bottom"><div class="demo-note">Made for the everyday.<br>Built to keep things moving.<br><br>LOCAL DEMO · v1.0</div><div class="profile"><span class="avatar">${escape(
      state.account.name
        .split(" ")
        .map((x) => x[0])
        .join(""),
    )}</span><span><strong>${escape(state.account.name)}</strong>Demo operator</span><button data-switch aria-label="Switch business">⇄</button></div></div></aside><main class="main"><header class="topbar"><button class="business" data-switch aria-label="Switch business"><span>◈</span>${escape(state.account.businessName)} <span>⌄</span></button><small>Your business, in good order.</small><span class="simulated">● &nbsp; SIMULATED COMMERCE</span></header><div class="content"><div class="heading"><div><div class="eyebrow">${state.view === "catalog" ? "The everyday collection" : "Your operations, considered"}</div><h1>${{ catalog: "A place for good things.", inventory: "Every unit accounted for.", orders: "From cart to doorstep.", activity: "The story behind the stock." }[state.view]}</h1><p class="subtitle">${{ catalog: "Explore your catalog. Build an order. Keep the good things moving.", inventory: "Physical stock, active reservations, and room for what comes next.", orders: "Follow each order from its first reservation to its final delivery.", activity: "A clear record of products, reservations, and every change along the way." }[state.view]}</p></div>${state.view === "inventory" ? '<button class="primary" id="new-product">＋ New product</button>' : `<span class="date">${new Date().toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" })}</span>`}</div>${renderStats()}<div id="view-content"></div><footer class="footer-note"><span>Stockade · Simple tools. Thoughtful commerce.</span><span>Local data · All payments simulated</span></footer></div></main></div>`;
  document.querySelectorAll("[data-view]").forEach(
    (button) =>
      (button.onclick = () => {
        state.view = button.dataset.view;
        state.search = "";
        state.filter = "all";
        render();
      }),
  );
  document
    .querySelectorAll("[data-switch]")
    .forEach((button) => (button.onclick = switchBusiness));
  $("#new-product")?.addEventListener("click", () => productForm());
  renderView();
}

function renderStats() {
  const s = state.summary;
  return `<section class="stats" aria-label="Business summary">${[
    [
      "Available units",
      (s.availableUnits || 0).toLocaleString(),
      "Ready for their next chapter",
      "↗",
    ],
    [
      "Reserved units",
      (s.reservedUnits || 0).toLocaleString(),
      "Held for active orders",
      "◷",
    ],
    [
      "Simulated revenue",
      money(s.paidRevenueCents || 0),
      "Paid & shipped · excludes refunds",
      "↗",
    ],
    [
      "Total orders",
      s.orderCount || 0,
      `${s.productCount || 0} products in your catalog`,
      "↗",
    ],
  ]
    .map(
      ([title, value, note, mark]) =>
        `<div class="stat"><div class="stat-label">${title}<span>${mark}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`,
    )
    .join("")}</section>`;
}

function filters(placeholder, options) {
  return `<div class="search-wrap"><input class="search" id="search" type="search" aria-label="Search ${state.view}" placeholder="${placeholder}" value="${escape(state.search)}"><select class="search" id="filter" aria-label="Filter ${state.view}">${options.map(([value, title]) => `<option value="${value}" ${state.filter === value ? "selected" : ""}>${title}</option>`).join("")}</select></div>`;
}

function bindFilters() {
  const search = $("#search");
  if (search)
    search.oninput = () => {
      state.search = search.value;
      renderResults();
    };
  const filter = $("#filter");
  if (filter)
    filter.onchange = () => {
      state.filter = filter.value;
      renderResults();
    };
}

function art(product) {
  const name = product.name.toLowerCase();
  let shape;
  if (name.includes("tote"))
    shape =
      '<path d="M25 42h70l6 70H19z" fill="#c6b798"/><path d="M40 47V31c0-23 40-23 40 0v16" fill="none" stroke="#a99a7b" stroke-width="7"/><path d="M25 42v66M95 42v66" stroke="#d9cbae" stroke-width="3"/><path d="M48 67h24v22H48z" fill="#485e48"/><path d="M54 72v12M60 70v16M66 74v10" stroke="#e5ddc7" stroke-width="2"/>';
  else if (/mug|cup/.test(name))
    shape =
      '<path d="M84 47h12c24 0 24 37 0 37H85" fill="none" stroke="currentColor" stroke-width="10"/><path d="M23 35h64v55c0 23-64 23-64 0z" fill="currentColor"/><ellipse cx="55" cy="35" rx="32" ry="9" fill="#cbc0a8"/><ellipse cx="55" cy="36" rx="26" ry="5" fill="#735f49"/><path d="M32 50v34" stroke="#ffffff30" stroke-width="5" stroke-linecap="round"/>';
  else if (/journal|note/.test(name))
    shape =
      '<path d="m24 19 65-7 8 92-64 8z" fill="currentColor"/><path d="m24 19 9 93-7-5-8-84z" fill="#526746"/><path d="m34 108 61-7v5l-62 7z" fill="#eae2ce"/><path d="m60 16 7 78" stroke="#bcb598" stroke-width="3"/><path d="m39 40 35-3m-34 9 25-2" stroke="#bfc6a5" stroke-width="2"/>';
  else if (/bottle|flask/.test(name))
    shape =
      '<rect x="43" y="7" width="34" height="14" rx="4" fill="#3e5145"/><path d="M43 21h34v13c0 7 10 8 10 19v50c0 17-54 17-54 0V53c0-11 10-12 10-19z" fill="currentColor"/><path d="M41 52v45" stroke="#ffffff18" stroke-width="6" stroke-linecap="round"/><path d="M52 69v20m7-24v28m7-20v12" stroke="#bdc6b4" stroke-width="2"/>';
  else if (/candle|tea/.test(name))
    shape =
      '<path d="M28 42h65v58c0 16-65 16-65 0z" fill="currentColor"/><ellipse cx="60" cy="42" rx="33" ry="9" fill="#d8c4a3"/><ellipse cx="60" cy="42" rx="27" ry="6" fill="#ece4ce"/><path d="M60 40v-9" stroke="#615848" stroke-width="2"/><path d="M39 59h43v32H39z" fill="#eae4d5"/><text x="60" y="72" text-anchor="middle" font-family="Georgia" font-size="6" fill="#6f775d">NORTHSTAR</text><path d="M47 79h26m-23 4h20" stroke="#a7ab92"/>';
  else if (name.includes("cap"))
    shape =
      '<path d="M28 72C20 1 94 3 96 75z" fill="currentColor"/><path d="M29 70c30-7 60-3 68 4l21 17c-19 9-66 5-91-9z" fill="#878673"/><path d="M62 23v42" stroke="#ffffff20" stroke-width="2"/><path d="M49 46v12m8-15v18m8-12v7" stroke="#d7d4bd" stroke-width="2"/>';
  else
    shape =
      '<path d="m22 28 69-10 12 79-69 13z" fill="currentColor"/><path d="m28 34 57-8m-55 17 56-8m-54 18 56-8m-54 18 56-8m-54 18 56-8m-54 18 56-8" stroke="#ffffff40" stroke-width="2"/>';
  return `<svg viewBox="0 0 120 125" aria-hidden="true">${shape}</svg>`;
}

export function renderView() {
  const view = $("#view-content");
  if (state.view === "catalog")
    view.innerHTML = `<div class="catalog-layout"><section><div class="section-top"><h2>The catalog <small>${state.products.length} considered essentials</small></h2></div>${filters(
      "Search products or SKU…",
      [
        ["all", "All products"],
        ["available", "In stock"],
        ["low", "Low stock"],
      ],
    )}<div id="results" class="product-grid"></div></section><aside id="cart"></aside></div>`;
  else if (state.view === "inventory")
    view.innerHTML = `<div class="section-top"><h2>Inventory <small>${state.products.length} products</small></h2><span class="subtitle">Available = on hand − reserved</span></div>${filters(
      "Search inventory…",
      [
        ["all", "All products"],
        ["low", "Low stock"],
        ["reserved", "Reserved stock"],
      ],
    )}<div id="results"></div>`;
  else if (state.view === "orders")
    view.innerHTML = `<div class="section-top"><h2>All orders <small>${state.orders.length} total</small></h2><button class="secondary" id="expire">Check expired holds</button></div>${filters("Search order number or product…", [["all", "All statuses"], ...["reserved", "paid", "shipped", "cancelled", "declined", "expired", "refunded"].map((x) => [x, label(x)])])}<div id="results"></div>`;
  else
    view.innerHTML = `<div class="section-top"><h2>Activity ledger <small>Latest 100 events</small></h2><button class="secondary" id="refresh-activity">Refresh</button></div><div id="results"></div>`;
  bindFilters();
  renderResults();
  if (state.view === "catalog") renderCart();
  $("#expire")?.addEventListener("click", async () => {
    try {
      const result = await api("/maintenance/expire", {});
      await refresh();
      render();
      toast(
        `${result.expiredCount} reservation${result.expiredCount === 1 ? "" : "s"} expired.`,
      );
    } catch (error) {
      toast(error.message);
    }
  });
  $("#refresh-activity")?.addEventListener("click", async () => {
    try {
      await refresh();
      render();
      toast("Activity is up to date.");
    } catch (error) {
      toast(error.message);
    }
  });
}

export function renderResults() {
  const results = $("#results");
  const search = state.search.toLowerCase();
  if (["catalog", "inventory"].includes(state.view)) {
    const products = state.products
      .filter((p) =>
        `${p.name} ${p.sku} ${p.description}`.toLowerCase().includes(search),
      )
      .filter((p) =>
        state.filter === "available"
          ? p.available > 0
          : state.filter === "low"
            ? p.available <= 10
            : state.filter === "reserved"
              ? p.reserved > 0
              : true,
      );
    if (!products.length) {
      results.innerHTML =
        '<div class="empty">No products match your search.</div>';
      return;
    }
    if (state.view === "catalog")
      results.innerHTML = products
        .map(
          (p) =>
            `<article class="product" data-product-id="${p.id}"><div class="product-art"><span class="stock-tag ${p.available <= 10 ? "low" : ""}">${p.available === 0 ? "Out of stock" : p.available <= 10 ? `Only ${p.available} left` : `${p.available} available`}</span>${art(p)}</div><div class="product-info"><div class="sku">${escape(p.sku)}</div><h3>${escape(p.name)}</h3><p class="product-description">${escape(p.description)}</p><div class="product-footer"><span class="price">${money(p.priceCents)}</span><button class="add-button" data-add="${p.id}" ${p.available === 0 || state.pending ? "disabled" : ""} aria-label="Add ${escape(p.name)} to cart">＋ Add</button></div></div></article>`,
        )
        .join("");
    else
      results.innerHTML = `<div class="panel table-scroll"><table><thead><tr><th>Product / SKU</th><th>Unit price</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Actions</th></tr></thead><tbody>${products.map((p) => `<tr><td><strong>${escape(p.name)}</strong><small>${escape(p.sku)} · v${p.version}</small></td><td>${money(p.priceCents)}</td><td>${p.onHand}</td><td>${p.reserved}</td><td><span class="status ${p.available <= 10 ? "reserved" : "paid"}">${p.available} units</span></td><td><button class="row-button" data-adjust="${p.id}" aria-label="Adjust ${escape(p.name)} stock">Adjust stock</button></td></tr>`).join("")}</tbody></table></div>`;
    document
      .querySelectorAll("[data-add]")
      .forEach(
        (button) =>
          (button.onclick = () => addCart(Number(button.dataset.add))),
      );
    document
      .querySelectorAll("[data-adjust]")
      .forEach(
        (button) =>
          (button.onclick = () => stockForm(Number(button.dataset.adjust))),
      );
  } else if (state.view === "orders") {
    const orders = state.orders.filter(
      (o) =>
        `${o.number} ${o.items.map((x) => x.name).join(" ")}`
          .toLowerCase()
          .includes(search) &&
        (state.filter === "all" || o.status === state.filter),
    );
    results.innerHTML = orders.length
      ? `<div class="panel table-scroll"><table><thead><tr><th>Order</th><th>Created</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${orders.map((o) => `<tr><td><strong>${escape(o.number)}</strong><small>Local simulated order</small></td><td>${date(o.createdAt)}</td><td>${o.items.reduce((n, x) => n + x.quantity, 0)} units</td><td>${money(o.totalCents)}</td><td><span class="status ${o.status}">${label(o.status)}</span></td><td><button class="row-button" data-order="${o.id}">View order</button></td></tr>`).join("")}</tbody></table></div>`
      : '<div class="panel empty"><span class="empty-symbol">↗</span>No orders here yet.<br>Your next chapter starts in the catalog.</div>';
    bindOrders();
  } else {
    results.innerHTML = state.events.length
      ? `<div class="panel">${state.events.map((event) => `<div class="activity-row"><span class="activity-dot"></span><div><strong>${escape(event.detail)}</strong><small>${date(event.createdAt)}${event.orderId ? ` · <button class="row-button" data-order="${escape(event.orderId)}">View order</button>` : ""}</small></div><span class="status">${label(event.action)}</span></div>`).join("")}</div>`
      : '<div class="panel empty"><span class="empty-symbol">◷</span>A fresh start.<br>Product and order changes will appear here.</div>';
    bindOrders();
  }
}

function bindOrders() {
  document
    .querySelectorAll("[data-order]")
    .forEach(
      (button) => (button.onclick = () => showOrder(button.dataset.order)),
    );
}
