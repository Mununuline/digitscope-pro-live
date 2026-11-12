(function () {
  "use strict";
  const statusEl = document.getElementById("derivDemoStatus");
  if (!statusEl) return;
  const countEl = document.getElementById("derivDemoCount");
  const accountsEl = document.getElementById("derivDemoAccounts");
  const messageEl = document.getElementById("derivDemoMessage");
  const connectBtn = document.getElementById("derivConnectBtn");
  const disconnectBtn = document.getElementById("derivDisconnectBtn");

  function showAccounts(accounts) {
    accountsEl.replaceChildren();
    if (!accounts.length) {
      accountsEl.textContent = "No verified Demo account was returned by Deriv.";
      return;
    }
    accounts.forEach(function (account) {
      const row = document.createElement("div");
      row.className = "evaluation";
      const label = document.createElement("span");
      label.textContent = account.display_name + " · " + account.account_id;
      const value = document.createElement("strong");
      value.textContent = account.balance === null
        ? (account.currency || "Demo")
        : account.balance.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + account.currency;
      row.append(label, value);
      accountsEl.appendChild(row);
    });
  }

  async function refresh() {
    try {
      const response = await fetch("/api/deriv/status", { credentials: "same-origin", cache: "no-store" });
      const data = await response.json();
      statusEl.textContent = data.connected ? "Connected · Demo only" : "Not connected";
      countEl.textContent = String((data.accounts || []).length);
      connectBtn.hidden = Boolean(data.connected);
      disconnectBtn.hidden = !data.connected;
      showAccounts(data.accounts || []);
      if (data.error) messageEl.textContent = data.error;
      else if (data.connected) messageEl.textContent = "OAuth connected. Only accounts explicitly identified by Deriv as Demo are displayed. No orders have been placed.";
      else messageEl.textContent = "Connect through Deriv's secure sign-in. No account password or token is entered into DigitScope Pro.";
    } catch (_error) {
      statusEl.textContent = "Status unavailable";
      messageEl.textContent = "Could not check the Deriv connection. Please try again.";
    }
  }

  connectBtn.addEventListener("click", function () {
    messageEl.textContent = "Opening Deriv secure sign-in…";
    window.location.assign("/deriv/connect");
  });

  disconnectBtn.addEventListener("click", async function () {
    disconnectBtn.disabled = true;
    try {
      await fetch("/api/deriv/disconnect", { method: "POST", credentials: "same-origin" });
      await refresh();
    } finally {
      disconnectBtn.disabled = false;
    }
  });

  refresh();
  if (new URLSearchParams(window.location.search).get("deriv") === "connected") {
    history.replaceState({}, document.title, window.location.pathname);
  }
})();