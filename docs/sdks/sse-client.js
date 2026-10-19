// sse-client.js
// Connects to /api/events using a short-lived ticket, because EventSource
// cannot send an Authorization header.

/*
 * How to use this client:
 *
 * import { connectEvents } from "./sse-client.js";

const conn = connectEvents({
  baseUrl: "https://your-server",
  getAccessToken: async () => localStorage.getItem("access_token"),
  onEvent: (name, data) => console.log("event", name, data),
  onStatus: (status, info) => console.log("sse", status, info),
});

// on logout or page teardown
window.addEventListener("beforeunload", () => conn.close());
 * 
 * */

export function connectEvents({ baseUrl, getAccessToken, onEvent, onStatus }) {
  let es = null;
  let closed = false;
  let retry = 1000;

  async function open() {
    if (closed) return;

    try {
      // 1. Trade the Bearer token for a single-use ticket and a server-issued stream id
      const r = await fetch(`${baseUrl}/api/sse/ticket`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await getAccessToken()}` },
      });
      if (!r.ok) throw new Error(`ticket request failed: ${r.status}`);
      const { eventId, ticket } = await r.json();

      // 2. Open the stream with the ticket
      es = new EventSource(
        `${baseUrl}/api/events/${encodeURIComponent(eventId)}?ticket=${encodeURIComponent(ticket)}`
      );

      es.addEventListener("connected", () => {
        retry = 1000;
        onStatus?.("connected", { eventId });
      });

      // Named events pushed via sse.push; add one listener per event name you use
      for (const name of ["notification", "task.progress"]) {
        es.addEventListener(name, (e) => onEvent(name, JSON.parse(e.data)));
      }

      // Unnamed events
      es.onmessage = (e) => onEvent("message", JSON.parse(e.data));

      // 3. The ticket is single-use, so the browser's built-in auto-reconnect
      // (which reuses the same URL) would get a 401. Close it and start over
      // with a fresh ticket.
      es.onerror = () => {
        es.close();
        onStatus?.("disconnected");
        scheduleReconnect();
      };
    } catch (err) {
      onStatus?.("error", err);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (closed) return;
    setTimeout(open, retry);
    retry = Math.min(retry * 2, 30000); // exponential backoff, capped at 30s
  }

  open();

  return {
    close() {
      closed = true;
      es?.close();
    },
  };
}
