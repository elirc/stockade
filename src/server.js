import { createApp } from "./app.js";
import { resolve } from "node:path";
const port = Number(process.env.PORT ?? 4318);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("PORT must be 0–65535.");
const instance = createApp({
  dbPath: process.env.DB_PATH || resolve("data/stockade.sqlite"),
  reservationTtlMs: Number(process.env.RESERVATION_TTL_MS ?? 300000),
});
const server = instance.app.listen(port, "127.0.0.1", () =>
  console.log(`Stockade ready http://127.0.0.1:${server.address().port}`),
);
const sweep = setInterval(() => {
  try {
    instance.expireReservations();
  } catch (error) {
    console.error("Reservation sweep failed:", error.message);
  }
}, 10000);
sweep.unref();
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(sweep);
  server.close(() => {
    instance.close();
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
