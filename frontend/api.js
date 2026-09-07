// Single API wrapper — structural enforcement of the spec's §3 lesson:
// "every network call must have both a success path and a visible failure path."
// Every call through here shows a toast on failure automatically, so a screen
// can never silently sit there blank because a developer forgot an error handler.

function toast(message, kind = 'error') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function getSessionId() {
  return localStorage.getItem('sessionId');
}

async function api(path, { method = 'GET', body, silent = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const sid = getSessionId();
  if (sid) headers['x-session-id'] = sid;

  let res, data;
  try {
    res = await fetch(`${window.API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    if (!silent) toast('Network error — could not reach the server.');
    throw networkErr;
  }

  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message = data?.error || `Request failed (${res.status})`;
    if (res.status === 401) {
      localStorage.removeItem('sessionId');
      if (!silent) toast('Session expired — please log in again.');
      renderApp();
    } else if (!silent) {
      toast(message);
    }
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}
