(function () {
  const API_BASE_URL = "https://words.reach.uz";
  const FLUSH_INTERVAL_MS = 10000;
  const MAX_BUFFERED_EVENTS = 200;

  let sessionId = null;
  let buffer = [];

  function queueEvent(type, payload) {
    buffer.push({ type, payload, occurred_at: new Date().toISOString() });
    if (buffer.length > MAX_BUFFERED_EVENTS) {
      buffer.shift();
    }
  }

  function flush(useBeacon) {
    if (!sessionId || buffer.length === 0) return;

    const events = buffer;
    buffer = [];
    const body = JSON.stringify({ session_id: sessionId, events });

    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(
        `${API_BASE_URL}/api/events`,
        new Blob([body], { type: "application/json" })
      );
      return;
    }

    fetch(`${API_BASE_URL}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }

  function startSession() {
    const telegram = window.Telegram && window.Telegram.WebApp;
    if (!telegram || !telegram.initData) return;

    telegram.ready();

    fetch(`${API_BASE_URL}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: telegram.initData }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data && data.session_id) {
          sessionId = data.session_id;
          flush(false);
        }
      })
      .catch(() => {});
  }

  function submitPhoneNumber(phoneNumber) {
    if (!sessionId) {
      return Promise.reject(new Error("no_session"));
    }

    return fetch(`${API_BASE_URL}/api/user/phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, phone_number: phoneNumber }),
    }).then((response) => {
      if (!response.ok) throw new Error("request_failed");
      return response.json();
    });
  }

  window.trackEvent = queueEvent;
  window.submitPhoneNumber = submitPhoneNumber;

  document.addEventListener("DOMContentLoaded", startSession);
  setInterval(() => flush(false), FLUSH_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
  window.addEventListener("pagehide", () => flush(true));
})();
