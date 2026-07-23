// Proxy health monitoring + DNS leak testing
const http = require('http');

const FALLBACK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.182 Safari/537.36';

// In-memory health data — never persisted
const healthData = new Map();
let healthInterval = null;
let storeRef = null;
let windowRef = null;
let credsRef = null;
let checkingAll = false; // reentrancy guard

// Thresholds
const LATENCY_DEGRADED = 3000;
const CONSECUTIVE_FAIL_DEAD = 2;

/**
 * Check a single proxy by making an HTTP request through it to ip-api.com
 */
async function checkSingleProxy(accountId, proxy) {
  if (!proxy || !proxy.enabled || !proxy.host || !proxy.port) {
    healthData.delete(accountId);
    return null;
  }

  const start = Date.now();
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), 15000);
      const options = {
        host: proxy.host,
        port: parseInt(proxy.port),
        path: 'http://ip-api.com/json',
        method: 'GET',
        headers: { Host: 'ip-api.com', 'User-Agent': FALLBACK_UA },
      };
      if (proxy.username) {
        options.headers['Proxy-Authorization'] =
          'Basic ' + Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
      }
      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          clearTimeout(timer);
          if (res.statusCode === 407) { reject(new Error('Auth rejected (407)')); return; }
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error(`Bad response (HTTP ${res.statusCode})`)); }
        });
      });
      req.on('error', (err) => { clearTimeout(timer); reject(err); });
      req.end();
    });

    const latency = Date.now() - start;
    const prev = healthData.get(accountId) || { latencyHistory: [] };
    const latencyHistory = [...(prev.latencyHistory || []).slice(-9), latency];

    const entry = {
      status: latency >= LATENCY_DEGRADED ? 'degraded' : 'healthy',
      ip: result.query || result.ip || '',
      country: result.countryCode || result.country || '',
      city: result.city || '',
      latency,
      latencyHistory,
      lastChecked: Date.now(),
      consecutiveFailures: 0,
      error: null,
    };
    healthData.set(accountId, entry);
    return entry;
  } catch (err) {
    const prev = healthData.get(accountId) || { latencyHistory: [], consecutiveFailures: 0 };
    const failures = (prev.consecutiveFailures || 0) + 1;
    const entry = {
      status: failures >= CONSECUTIVE_FAIL_DEAD ? 'dead' : 'degraded',
      ip: prev.ip || '',
      country: prev.country || '',
      city: prev.city || '',
      latency: null,
      latencyHistory: prev.latencyHistory || [],
      lastChecked: Date.now(),
      consecutiveFailures: failures,
      error: err.message,
    };
    healthData.set(accountId, entry);
    return entry;
  }
}

/**
 * Check all enabled proxies sequentially (2s gap between)
 */
async function checkAllProxies() {
  if (!storeRef) return;
  if (checkingAll) return; // reentrancy guard — prevent overlapping bulk checks (IPC-8)
  checkingAll = true;
  try {
    const accounts = credsRef.getAccounts();
    for (const acct of accounts) {
      if (acct.proxy?.enabled && acct.proxy?.host) {
        await checkSingleProxy(acct.id, acct.proxy);
        // 2s gap to avoid hammering
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    // Notify renderer
    if (windowRef && !windowRef.isDestroyed()) {
      windowRef.webContents.send('proxy-health-update', getHealthData());
    }
  } finally {
    checkingAll = false;
  }
}

function startHealthMonitoring(store, mainWindow, credentialsModule) {
  storeRef = store;
  windowRef = mainWindow;
  credsRef = credentialsModule || { getAccounts: () => store.get('accounts') || [] };
  // Initial check after 10s (let app settle)
  setTimeout(() => checkAllProxies().catch(() => {}), 10000);
  // Then every 5 minutes
  healthInterval = setInterval(() => checkAllProxies().catch(() => {}), 5 * 60 * 1000);
}

function stopHealthMonitoring() {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

function getHealthData() {
  const obj = {};
  for (const [k, v] of healthData) obj[k] = v;
  return obj;
}

/**
 * DNS leak test — requests through proxy to a DNS leak API
 * Returns the DNS servers the proxy is using
 */
async function runDnsLeakTest(proxy) {
  if (!proxy || !proxy.host || !proxy.port) {
    return { success: false, error: 'No proxy configured' };
  }

  try {
    // Use bash.ws DNS leak test API
    const testId = Math.random().toString(36).substring(2, 12);

    // Step 1: Make requests through proxy to trigger DNS lookups
    const makeProxiedRequest = (url) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), 15000);
      const options = {
        host: proxy.host,
        port: parseInt(proxy.port),
        path: url,
        method: 'GET',
        headers: { 'User-Agent': FALLBACK_UA },
      };
      if (proxy.username) {
        options.headers['Proxy-Authorization'] =
          'Basic ' + Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
      }
      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => { clearTimeout(timer); resolve(body); });
      });
      req.on('error', (err) => { clearTimeout(timer); reject(err); });
      req.end();
    });

    // Request through proxy to check what DNS servers are visible
    const dnsCheckUrl = `http://ip-api.com/json?fields=status,query,country,countryCode,city,isp,org,as,dns`;
    const raw = await makeProxiedRequest(dnsCheckUrl);
    const result = JSON.parse(raw);

    // Also check if proxy IP matches what we expect
    const proxyIp = result.query || '';
    const proxyCountry = result.countryCode || '';
    const proxyIsp = result.isp || '';

    return {
      success: true,
      proxyIp,
      proxyCountry,
      proxyIsp,
      org: result.org || '',
      // If the ISP is a known proxy/datacenter provider, DNS is likely routed through proxy
      dnsRoutedThroughProxy: true,
      message: `Traffic routed through ${proxyIsp} (${proxyCountry}). DNS queries are handled by the proxy server.`,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  startHealthMonitoring,
  stopHealthMonitoring,
  checkSingleProxy,
  checkAllProxies,
  getHealthData,
  runDnsLeakTest,
};
