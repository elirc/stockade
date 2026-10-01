const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value / 100,
  );
const date = (value) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const label = (value) =>
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const icons = {
  catalog:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  orders: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h3"/>',
  inventory:
    '<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M7 5l9 4"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${icons[name] || icons.catalog}</svg>`;
const brand =
  '<div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="brand-name">stockade</span></div>';
const state = {
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
let toastTimer,
  accountEpoch = 0,
  refreshSequence = 0,
  dialogEpoch = 0,
  dialogBusy = false,
  loginBusy = false,
  switchBusy = false;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 5000);
}
async function api(path, body, method = "POST") {
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
    if (data.code === "ACCOUNT_CHANGED") location.reload();
    const error = new Error(data.error || "The request failed.");
    error.status = response.status;
    error.code = data.code;
    error.current = data.current;
    throw error;
  }
  return data;
}
function restoreCart() {
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
function saveCart() {
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
async function refresh() {
  const epoch = accountEpoch,
    sequence = ++refreshSequence,
    displayedAccount = state.account?.id;
  const session = await api("/session");
  if (epoch !== accountEpoch || sequence !== refreshSequence || !state.account)
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
  if (epoch !== accountEpoch || sequence !== refreshSequence || !state.account)
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
function renderLogin() {
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
      if (loginBusy || switchBusy) return;
      loginBusy = true;
      accountEpoch++;
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
        loginBusy = false;
      }
    }),
  );
}
function render() {
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
function renderView() {
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
function renderResults() {
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
function addCart(productId) {
  if (state.pending) return;
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
  state.checkoutKey = null;
  saveCart();
  renderCart();
}
function renderCart() {
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
async function checkout() {
  if (state.pending || !state.cart.length || switchBusy) return;
  state.pending = true;
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
    if (error.status >= 400 && error.status < 500 && error.status !== 401) {
      state.unresolved = false;
      saveCart();
    }
    renderCart();
    const box = $("#checkout-error");
    if (box)
      box.innerHTML = `<div class="message error" role="alert">${escape(error.message)} ${state.unresolved ? "Your checkout key and cart are saved. Retry safely to recover the same order." : ""}</div>`;
    if (error.status === 401) {
      accountEpoch++;
      state.account = null;
      renderLogin();
    } else
      try {
        if (await refresh()) renderResults();
      } catch {}
  }
}
function closeDialog() {
  if (dialogBusy) return;
  dialogEpoch++;
  $("#dialog").close();
}
function setDialogBusy(value) {
  dialogBusy = value;
  $("#dialog")
    .querySelectorAll("button,input,textarea,select")
    .forEach((control) => (control.disabled = value));
}
function openDialog(html) {
  if (dialogBusy) return;
  dialogEpoch++;
  const dialog = $("#dialog");
  dialog.innerHTML = html;
  dialog.querySelector("[data-close]")?.addEventListener("click", closeDialog);
  if (!dialog.open) dialog.showModal();
}
function dialogHead(title) {
  return `<div class="dialog-head"><h2>${escape(title)}</h2><button class="close" data-close aria-label="Close dialog">×</button></div>`;
}
async function showOrder(orderId) {
  if (dialogBusy || switchBusy) return;
  const request = ++dialogEpoch,
    epoch = accountEpoch;
  try {
    const { order, events } = await api(`/orders/${orderId}`);
    if (request !== dialogEpoch || epoch !== accountEpoch) return;
    const status = order.status;
    openDialog(
      `${dialogHead(order.number)}<div class="order-meta"><div><span class="status ${status}">${label(status)}</span><br>Created ${date(order.createdAt)}</div><div>${status === "reserved" ? `Reservation expires<br><strong>${date(order.expiresAt)}</strong>` : "Local simulated commerce"}</div></div><div class="order-items">${order.items.map((item) => `<div><span>${escape(item.name)}<br><small>${item.quantity} × ${money(item.unitPriceCents)} · ${escape(item.sku)}</small></span><strong>${money(item.lineTotalCents)}</strong></div>`).join("")}<div><strong>Order total</strong><strong>${money(order.totalCents)}</strong></div></div><div class="message">All payments and refunds are simulated locally. No card is collected and no real money moves.</div>${status === "shipped" ? '<label class="checkbox"><input id="restock" type="checkbox" checked> Restock returned items with this refund</label>' : ""}<div class="order-actions">${status === "reserved" ? '<button class="primary" data-action="pay" data-outcome="approved">Simulate approved payment</button><button class="secondary" data-action="pay" data-outcome="declined">Simulate decline</button><button class="secondary danger" data-action="cancel">Cancel order</button>' : status === "paid" ? '<button class="primary" data-action="ship">Mark as shipped</button>' : status === "shipped" ? '<button class="primary" data-action="refund">Simulate full refund</button>' : `<p class="subtitle">${status === "refunded" ? `Refund complete. Items ${order.restocked ? "were returned to stock" : "were not restocked"}.` : "This order is closed. Its reservation has been released."}</p>`}</div><div id="order-error"></div><h3>Order timeline</h3>${events.map((event) => `<div class="activity-row"><span class="activity-dot"></span><div><strong>${escape(event.detail)}</strong><small>${date(event.createdAt)}</small></div></div>`).join("")}`,
    );
    document.querySelectorAll("[data-action]").forEach(
      (button) =>
        (button.onclick = async () => {
          if (dialogBusy) return;
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
function productForm() {
  if (dialogBusy || switchBusy) return;
  openDialog(
    `${dialogHead("A new good thing.")}<p class="subtitle">Add a product and its opening inventory.</p><form id="product-form"><div class="form-grid"><label class="full">Product name<input name="name" maxlength="120" required></label><label>SKU<input name="sku" pattern="[A-Z0-9-]{2,32}" maxlength="32" placeholder="NS-PRODUCT" required></label><label>Price (USD)<input name="price" type="number" step="0.01" min="0.01" max="1000000" required></label><label>Opening units<input name="stock" type="number" step="1" min="0" max="1000000000" value="0" required></label><label class="full">Description<textarea name="description" maxlength="4000"></textarea></label></div><div id="form-error"></div><div class="form-actions"><button type="submit" class="primary">Create product</button></div></form>`,
  );
  $("#product-form").onsubmit = async (event) => {
    event.preventDefault();
    if (dialogBusy) return;
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
function stockForm(productId) {
  if (dialogBusy || switchBusy) return;
  const product = state.products.find((x) => x.id === productId);
  openDialog(
    `${dialogHead("Adjust stock")}<h3>${escape(product.name)}</h3><p class="subtitle">${escape(product.sku)} · ${product.onHand} on hand · ${product.reserved} reserved · Version ${product.version}</p><form id="stock-form"><div class="message">Use a positive number to receive stock or a negative number to remove it. Reserved units cannot be removed.</div><div class="form-grid"><label>Change in units<input name="delta" type="number" step="1" min="-1000000000" max="1000000000" placeholder="e.g. 12 or -3" required></label><label class="full">Reason<textarea name="reason" maxlength="300" placeholder="e.g. New shipment received" required></textarea></label></div><div id="form-error"></div><div class="form-actions"><button type="submit" class="primary">Save adjustment</button></div></form>`,
  );
  let version = product.version;
  $("#stock-form").onsubmit = async (event) => {
    event.preventDefault();
    if (dialogBusy) return;
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
async function switchBusiness() {
  if (state.pending || dialogBusy || switchBusy) {
    toast(
      "Wait for the current operation to finish before switching businesses.",
    );
    return;
  }
  switchBusy = true;
  accountEpoch++;
  dialogEpoch++;
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
    switchBusy = false;
  }
}
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
$("#dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDialog();
});
$("#dialog").addEventListener("close", () => {
  dialogEpoch++;
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
setInterval(async () => {
  if (
    !state.account ||
    state.pending ||
    switchBusy ||
    loginBusy ||
    $("#dialog").open ||
    document.activeElement?.matches("input,textarea,select")
  )
    return;
  const epoch = accountEpoch;
  try {
    if (await refresh()) render();
  } catch (error) {
    if (epoch !== accountEpoch) return;
    if (error.status === 401) {
      accountEpoch++;
      state.account = null;
      renderLogin();
      toast("Demo session expired. Choose a business to continue.");
    }
  }
}, 30000);
