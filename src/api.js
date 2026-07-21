const BASE = 'https://app.onlyfansapi.com/api';

let apiKey = '';

export function setApiKey(key) {
  apiKey = key;
}


async function request(path, { method = 'GET', body, signal } = {}) {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 30000);

  if (signal) {
    if (signal.aborted) { ac.abort(); }
    else { signal.addEventListener('abort', () => ac.abort(), { once: true }); }
  }

  const opts = {
    method,
    signal: ac.signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(`${BASE}${path}`, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${text || res.statusText}`);
    }
    const json = await res.json();
    // API wraps everything in { status, response }
    return json.response ?? json;
  } finally {
    clearTimeout(timeout);
  }
}

// Accounts — returns array directly
export const listAccounts = () => request('/accounts');

// Chats
export const listChats = (acct, { limit = 20, offset = 0, signal } = {}) =>
  request(`/${acct}/chats?limit=${limit}&offset=${offset}&skip_users=none`, { signal }).then((r) => r.data || r);

// Mass Messaging
export const sendMassMessage = (acct, body) =>
  request(`/${acct}/mass-messaging`, { method: 'POST', body });
export const listMassMessageQueue = (acct, { limit = 20, offset = 0, signal } = {}) =>
  request(`/${acct}/mass-messaging?limit=${limit}&offset=${offset}`, { signal }).then((r) => r.data || r);
export const deleteMassMessage = (acct, id) =>
  request(`/${acct}/mass-messaging/${id}`, { method: 'DELETE' });

// User Lists
export const listUserLists = (acct, { signal } = {}) =>
  request(`/${acct}/user-lists`, { signal }).then((r) => r.data || r);

// Vault Media
export const listVaultMedia = (acct, { limit = 20, offset = 0, type, signal } = {}) => {
  const params = [`limit=${limit}`, `offset=${offset}`];
  if (type) params.push(`type=${type}`);
  return request(`/${acct}/media/vault?${params.join('&')}`, { signal }).then((r) => r.data || r);
};
