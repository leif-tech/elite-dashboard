// Proxy provider gateway registry + helper functions
// Each provider uses a backconnect gateway where session ID controls the exit IP

const PROVIDERS = {
  iproyal: {
    name: 'IPRoyal',
    gateway: 'geo.iproyal.com',
    port: '12321',
    buildPassword: (password, country, sessionId) =>
      `${password}_country-${country}_session-${sessionId}_lifetime-24h`,
  },
  smartproxy: {
    name: 'Smartproxy (Decodo)',
    gateway: 'gate.decodo.com',
    port: '10001',
    buildUsername: (username, country, sessionId) =>
      `user-${username}-session-${sessionId}-sessionduration-1440`,
    usernameAuth: true,
  },
  brightdata: {
    name: 'Bright Data',
    gateway: 'brd.superproxy.io',
    port: '33335',
    buildUsername: (username, country, sessionId) =>
      `${username}-session-${sessionId}-country-${country}`,
    usernameAuth: true,
  },
  oxylabs: {
    name: 'Oxylabs',
    gateway: 'pr.oxylabs.io',
    port: '7777',
    buildUsername: (username, country, sessionId) =>
      `customer-${username}-cc-${country}-sessid-${sessionId}`,
    usernameAuth: true,
  },
  proxyscrape: {
    name: 'ProxyScrape',
    gateway: 'rp.scrapegw.com',
    port: '6060',
    buildUsername: (username, country, sessionId) =>
      `${username}-country-${country}-session-${sessionId}-lifetime-120`,
    usernameAuth: true,
  },
  soax: {
    name: 'SOAX',
    gateway: 'proxy.soax.com',
    port: '5000',
    buildUsername: (username, country, sessionId) =>
      `package-${username}-country-${country}-sessionid-${sessionId}-sessionlength-3600`,
    usernameAuth: true,
  },
};

function generateSessionId(accountId) {
  return `${accountId.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;
}

/**
 * Build a proxy object for an account using a provider config
 * @param {object} providerConfig - { type, username, password, country }
 * @param {string} accountId - e.g. 'acct_123'
 * @param {string} [existingSessionId] - reuse existing session ID if provided
 * @returns {object} proxy object compatible with existing proxy system
 */
function buildProxyForAccount(providerConfig, accountId, existingSessionId) {
  const provider = PROVIDERS[providerConfig.type];
  if (!provider) return null;

  const sessionId = existingSessionId || generateSessionId(accountId);
  const country = providerConfig.country || 'us';

  let username = providerConfig.username;
  let password = providerConfig.password;

  if (provider.usernameAuth && provider.buildUsername) {
    username = provider.buildUsername(providerConfig.username, country, sessionId);
  }
  if (provider.buildPassword) {
    password = provider.buildPassword(providerConfig.password, country, sessionId);
  }

  return {
    enabled: true,
    protocol: 'http',
    host: provider.gateway,
    port: provider.port,
    username,
    password,
    providerType: providerConfig.type,
    sessionId,
    lastRotated: Date.now(),
  };
}

/**
 * Rotate proxy = generate new session ID = new exit IP
 */
function rotateProxy(providerConfig, accountId) {
  return buildProxyForAccount(providerConfig, accountId, null);
}

module.exports = { PROVIDERS, buildProxyForAccount, rotateProxy, generateSessionId };
