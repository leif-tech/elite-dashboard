const BASE = 'https://app.onlyfansapi.com/api';

let apiKey = '';

export function setApiKey(key) {
  apiKey = key;
}

export function getApiKey() {
  return apiKey;
}

async function request(path, { method = 'GET', body } = {}) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  const json = await res.json();
  // API wraps everything in { status, response }
  return json.response ?? json;
}

// Auth
export const whoami = () => request('/whoami');

// Accounts — returns array directly
export const listAccounts = () => request('/accounts');
export const disconnectAccount = (id) => request(`/accounts/${id}`, { method: 'DELETE' });

// Account details — returns { data: {...} }
export const getProfile = (acct) => request(`/${acct}/me`).then((r) => r.data || r);
export const getTopPercentage = (acct) => request(`/${acct}/me/top-percentage`).then((r) => r.data || r);
export const getSubscriberStats = (acct) => request(`/${acct}/subscribers/statistics`).then((r) => r.data || r);

// Earnings for a single account
export const getEarnings = (accountId, startDate, endDate) =>
  request('/analytics/summary/earnings', {
    method: 'POST',
    body: { account_ids: [accountId], start_date: startDate, end_date: endDate },
  }).then((r) => r.data || r);

// Posts
export const listPosts = (acct, { limit = 10, offset = 0, pinned } = {}) => {
  const params = [`limit=${limit}`, `offset=${offset}`, 'counters=true'];
  if (pinned) params.push('pinned=true');
  return request(`/${acct}/posts?${params.join('&')}`).then((r) => r.data || r);
};

// Chats
export const listChats = (acct, { limit = 20, offset = 0 } = {}) =>
  request(`/${acct}/chats?limit=${limit}&offset=${offset}&skip_users=none`).then((r) => r.data || r);

// Stories
export const listStories = (acct) => request(`/${acct}/stories`).then((r) => r.data || r);

// Notifications
export const getNotificationCounts = (acct) => request(`/${acct}/notifications/counts`).then((r) => r.data || r);

// Connect account
export const startAuth = (data) => request('/authenticate', { method: 'POST', body: data });
export const pollAuth = (attemptId) => request(`/authenticate/${attemptId}`);
export const submit2FA = (attemptId, code) =>
  request(`/authenticate/${attemptId}`, { method: 'PUT', body: { code } });

// Mass Messaging
export const sendMassMessage = (acct, body) =>
  request(`/${acct}/mass-messaging`, { method: 'POST', body });
export const listMassMessageQueue = (acct, { limit = 20, offset = 0 } = {}) =>
  request(`/${acct}/mass-messaging?limit=${limit}&offset=${offset}`).then((r) => r.data || r);
export const getMassMessage = (acct, id) =>
  request(`/${acct}/mass-messaging/${id}`).then((r) => r.data || r);
export const updateMassMessage = (acct, id, body) =>
  request(`/${acct}/mass-messaging/${id}`, { method: 'PUT', body });
export const deleteMassMessage = (acct, id) =>
  request(`/${acct}/mass-messaging/${id}`, { method: 'DELETE' });
export const getMassMessageOverview = (acct) =>
  request(`/${acct}/engagement/messages/mass-messages`).then((r) => r.data || r);

// User Lists
export const listUserLists = (acct) =>
  request(`/${acct}/user-lists`).then((r) => r.data || r);

// Vault Media
export const listVaultMedia = (acct, { limit = 20, offset = 0, type } = {}) => {
  const params = [`limit=${limit}`, `offset=${offset}`];
  if (type) params.push(`type=${type}`);
  return request(`/${acct}/media/vault?${params.join('&')}`).then((r) => r.data || r);
};

// Date helpers
export function getDateRange(range) {
  const end = new Date();
  const start = new Date();
  switch (range) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      break;
    case '7d':
      start.setDate(start.getDate() - 7);
      break;
    case '30d':
      start.setDate(start.getDate() - 30);
      break;
    case 'all':
      start.setFullYear(2015);
      break;
  }
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}
