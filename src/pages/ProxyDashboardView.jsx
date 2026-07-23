import { useState, useEffect, useRef, useCallback } from 'react';

function Toast({ message, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);
  const bg = type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-dark-600';
  return (
    <div className={`${bg} text-white text-xs px-4 py-2.5 rounded-lg shadow-lg animate-fade-in flex items-center gap-2`}>
      {type === 'success' && <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
      {type === 'error' && <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>}
      {type === 'info' && <svg className="w-3.5 h-3.5 shrink-0 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31.4" strokeLinecap="round"/></svg>}
      {message}
    </div>
  );
}

function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 items-end">
      {toasts.map(t => <Toast key={t.id} message={t.message} type={t.type} onDone={() => removeToast(t.id)} />)}
    </div>
  );
}

const COUNTRIES = [
  { code: 'us', name: 'United States' }, { code: 'gb', name: 'United Kingdom' },
  { code: 'ca', name: 'Canada' }, { code: 'de', name: 'Germany' },
  { code: 'fr', name: 'France' }, { code: 'nl', name: 'Netherlands' },
  { code: 'au', name: 'Australia' }, { code: 'jp', name: 'Japan' },
  { code: 'br', name: 'Brazil' }, { code: 'in', name: 'India' },
  { code: 'sg', name: 'Singapore' }, { code: 'kr', name: 'South Korea' },
  { code: 'it', name: 'Italy' }, { code: 'es', name: 'Spain' },
  { code: 'mx', name: 'Mexico' }, { code: 'pl', name: 'Poland' },
  { code: 'ro', name: 'Romania' }, { code: 'ua', name: 'Ukraine' },
  { code: 'ph', name: 'Philippines' }, { code: 'co', name: 'Colombia' },
];

function HealthDot({ status }) {
  const colors = { healthy: 'bg-green-500', degraded: 'bg-yellow-500', dead: 'bg-red-500' };
  return <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${colors[status] || 'bg-gray-600'}`} />;
}

function ManualProxyModal({ account, onClose, onSaved }) {
  const [form, setForm] = useState({
    enabled: true, protocol: 'http', host: '', port: '', username: '', password: '',
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (account?.proxy) setForm(account.proxy);
  }, [account]);

  const updateField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const handleTest = async () => {
    if (!form.host || !form.port) return;
    setTesting(true); setTestResult(null);
    try {
      const result = await window.electronAPI.testProxy({ proxy: form });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setSaving(true);
    await window.electronAPI.setProxy({ accountId: account.id, proxy: form });
    setSaving(false);
    onSaved();
  };

  const handleClear = async () => {
    const cleared = { enabled: false, protocol: 'http', host: '', port: '', username: '', password: '' };
    await window.electronAPI.setProxy({ accountId: account.id, proxy: cleared });
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-dark-800 border border-dark-500 rounded-xl p-6 w-[420px] space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold">Manual Proxy — {account.name}</h3>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.enabled} onChange={e => updateField('enabled', e.target.checked)} className="w-4 h-4 accent-accent" />
          <span className="text-sm">Enable proxy</span>
        </label>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Protocol</label>
          <select value={form.protocol} onChange={e => updateField('protocol', e.target.value)} className="input w-full py-2 text-sm">
            <option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option>
          </select>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Host</label>
            <input className="input w-full py-2 text-sm" placeholder="123.45.67.89" value={form.host} onChange={e => updateField('host', e.target.value)} />
          </div>
          <div className="w-24">
            <label className="block text-xs text-gray-400 mb-1">Port</label>
            <input className="input w-full py-2 text-sm" placeholder="8080" value={form.port} onChange={e => updateField('port', e.target.value)} />
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Username</label>
            <input className="input w-full py-2 text-sm" placeholder="optional" value={form.username} onChange={e => updateField('username', e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Password</label>
            <input className="input w-full py-2 text-sm" type="password" placeholder="optional" value={form.password} onChange={e => updateField('password', e.target.value)} />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={handleTest} disabled={!form.host || !form.port || testing} className="btn-ghost border border-dark-500 px-3 py-1.5 text-xs disabled:opacity-40">
            {testing ? 'Testing...' : 'Test'}
          </button>
          <button onClick={handleSave} disabled={!form.host || !form.port || saving} className="btn-primary px-3 py-1.5 text-xs">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={handleClear} className="btn-ghost text-red-400 hover:text-red-300 px-3 py-1.5 text-xs">Clear</button>
          <button onClick={onClose} className="btn-ghost px-3 py-1.5 text-xs ml-auto">Cancel</button>
        </div>

        {testResult && (
          <div className={`card ${testResult.success ? 'border-green-600/40' : 'border-red-600/40'}`}>
            {testResult.success ? (
              <div className="space-y-1">
                <p className="text-xs text-green-400 font-medium">Proxy working</p>
                <p className="text-xs text-gray-400">
                  IP: <span className="text-white">{testResult.ip}</span> | {testResult.country}
                  {testResult.city && ` | ${testResult.city}`} | {testResult.latency}ms
                </p>
              </div>
            ) : (
              <div>
                <p className="text-xs text-red-400 font-medium">Failed</p>
                <p className="text-xs text-gray-500">{testResult.error}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DnsLeakModal({ account, onClose }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.electronAPI.dnsLeakTest(account.id).then(r => {
      setResult(r);
      setLoading(false);
    }).catch(err => {
      setResult({ success: false, error: err.message });
      setLoading(false);
    });
  }, [account.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-dark-800 border border-dark-500 rounded-xl p-6 w-[420px] space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold">DNS Leak Test — {account.name}</h3>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31.4" strokeLinecap="round" /></svg>
            Testing DNS routing...
          </div>
        ) : result?.success ? (
          <div className="space-y-3">
            <div className="card border-green-600/40">
              <p className="text-xs text-green-400 font-medium mb-1">No DNS leak detected</p>
              <p className="text-xs text-gray-400">{result.message}</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-gray-400">Proxy IP: <span className="text-white">{result.proxyIp}</span></p>
              <p className="text-xs text-gray-400">Country: <span className="text-white">{result.proxyCountry}</span></p>
              <p className="text-xs text-gray-400">ISP: <span className="text-white">{result.proxyIsp}</span></p>
              <p className="text-xs text-gray-400">Org: <span className="text-white">{result.org}</span></p>
            </div>
          </div>
        ) : (
          <div className="card border-red-600/40">
            <p className="text-xs text-red-400 font-medium">Test failed</p>
            <p className="text-xs text-gray-500">{result?.error}</p>
          </div>
        )}
        <button onClick={onClose} className="btn-ghost border border-dark-500 px-3 py-1.5 text-xs w-full">Close</button>
      </div>
    </div>
  );
}

export default function ProxyDashboardView({ accounts, loginStatus, onAccountsChanged }) {
  const [providers, setProviders] = useState([]);
  const [providerConfig, setProviderConfig] = useState({
    type: 'manual', username: '', password: '', country: 'us',
    autoAssign: false, rotation: { enabled: false, intervalHours: 4 },
  });
  const [health, setHealth] = useState({});
  const [editAccount, setEditAccount] = useState(null);
  const [dnsAccount, setDnsAccount] = useState(null);
  const [applying, setApplying] = useState(false);
  const [testingProvider, setTestingProvider] = useState(false);
  const [providerTestResult, setProviderTestResult] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rotatingId, setRotatingId] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [saved, setSaved] = useState(false);
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const addToast = useCallback((message, type = 'success') => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, message, type }]);
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const refreshAccounts = useCallback(async () => {
    const accts = await window.electronAPI?.getAccounts();
    if (accts && onAccountsChanged) onAccountsChanged(accts);
  }, [onAccountsChanged]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.getProxyProvidersList().then(setProviders);
    api.getProxyProvider().then(c => { if (c) setProviderConfig(c); });
    api.getProxyHealth().then(setHealth);
    api.onProxyHealthUpdate(setHealth);
  }, []);

  const saveProviderConfig = async (config) => {
    setProviderConfig(config);
    await window.electronAPI.setProxyProvider(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateProvider = (key, value) => {
    const next = { ...providerConfig, [key]: value };
    saveProviderConfig(next);
  };

  const updateRotation = (key, value) => {
    const next = { ...providerConfig, rotation: { ...providerConfig.rotation, [key]: value } };
    saveProviderConfig(next);
  };

  const handleApplyAll = async () => {
    setApplying(true);
    addToast('Applying proxies to all accounts...', 'info');
    await window.electronAPI.applyProviderProxyAll();
    await refreshAccounts();
    addToast(`Proxies applied to ${accounts.length} account(s)`, 'success');
    await window.electronAPI.checkAllProxyHealth();
    setApplying(false);
  };

  const handleTestProvider = async () => {
    if (providerConfig.type === 'manual' || !providerConfig.username || !providerConfig.password) return;
    setTestingProvider(true); setProviderTestResult(null);
    addToast('Testing provider connection...', 'info');
    const testAcctId = accounts[0]?.id || 'test_' + Date.now();
    const result = await window.electronAPI.applyProviderProxy(testAcctId);
    if (result) {
      const h = await window.electronAPI.checkProxyHealth(testAcctId);
      setProviderTestResult(h);
      await refreshAccounts();
      addToast(h?.error ? 'Connection failed' : 'Provider connection working', h?.error ? 'error' : 'success');
    } else {
      setProviderTestResult({ error: 'Failed to build proxy' });
      addToast('Failed to build proxy', 'error');
    }
    setTestingProvider(false);
  };

  const handleRefreshAll = async () => {
    setRefreshing(true);
    addToast('Checking all proxies...', 'info');
    const data = await window.electronAPI.checkAllProxyHealth();
    setHealth(data);
    setRefreshing(false);
    const count = Object.values(data).filter(h => h.status === 'healthy').length;
    addToast(`Health check done — ${count} healthy`, 'success');
  };

  const handleRotate = async (accountId) => {
    setRotatingId(accountId);
    addToast('Rotating IP...', 'info');
    const result = await window.electronAPI.rotateProxy(accountId);
    if (result?.health) setHealth(h => ({ ...h, [accountId]: result.health }));
    await refreshAccounts();
    setRotatingId(null);
    addToast(result?.success ? `New IP: ${result.health?.ip || 'assigned'}` : 'Rotation failed', result?.success ? 'success' : 'error');
  };

  const handleTestSingle = async (accountId) => {
    setTestingId(accountId);
    const result = await window.electronAPI.checkProxyHealth(accountId);
    if (result) setHealth(h => ({ ...h, [accountId]: result }));
    setTestingId(null);
    addToast(result?.error ? `Test failed: ${result.error}` : `Proxy OK — ${result?.ip} (${result?.latency}ms)`, result?.error ? 'error' : 'success');
  };

  const handleToggle = async (accountId) => {
    const acct = accounts.find(a => a.id === accountId);
    if (!acct?.proxy) return;
    const updated = { ...acct.proxy, enabled: !acct.proxy.enabled };
    await window.electronAPI.setProxy({ accountId, proxy: updated });
    await refreshAccounts();
    addToast(updated.enabled ? 'Proxy enabled' : 'Proxy disabled', 'success');
  };

  const isProviderMode = providerConfig.type !== 'manual';

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Proxy Dashboard</h2>
          <p className="text-sm text-gray-500 mt-0.5">Manage proxies, monitor health, and configure providers.</p>
        </div>
        <button
          onClick={handleRefreshAll}
          disabled={refreshing}
          className="btn-ghost border border-dark-500 px-3 py-1.5 text-xs flex items-center gap-1.5 disabled:opacity-40"
        >
          <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          {refreshing ? 'Checking...' : 'Refresh All'}
        </button>
      </div>

      {/* Provider Config Section */}
      <div className="card mb-6">
        <h3 className="text-sm font-semibold mb-4">Provider Configuration</h3>
        <div className="grid grid-cols-2 gap-4 max-w-2xl">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Provider</label>
            <select
              value={providerConfig.type}
              onChange={e => updateProvider('type', e.target.value)}
              className="input w-full py-2 text-sm"
            >
              {providers.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Country</label>
            <select
              value={providerConfig.country}
              onChange={e => updateProvider('country', e.target.value)}
              className="input w-full py-2 text-sm"
            >
              {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>

          {isProviderMode && (
            <>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Username</label>
                <input
                  className="input w-full py-2 text-sm"
                  placeholder="Provider username"
                  value={providerConfig.username}
                  onChange={e => updateProvider('username', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Password</label>
                <input
                  className="input w-full py-2 text-sm"
                  type="password"
                  placeholder="Provider password"
                  value={providerConfig.password}
                  onChange={e => updateProvider('password', e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        {isProviderMode && (
          <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-dark-600">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={providerConfig.autoAssign}
                onChange={e => updateProvider('autoAssign', e.target.checked)}
                className="w-3.5 h-3.5 accent-accent"
              />
              <span className="text-xs text-gray-300">Auto-assign to new accounts</span>
            </label>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={providerConfig.rotation?.enabled}
                  onChange={e => updateRotation('enabled', e.target.checked)}
                  className="w-3.5 h-3.5 accent-accent"
                />
                <span className="text-xs text-gray-300">Auto-rotate every</span>
              </label>
              <input
                type="number"
                min="1"
                max="72"
                value={providerConfig.rotation?.intervalHours || 4}
                onChange={e => updateRotation('intervalHours', parseInt(e.target.value) || 4)}
                className="input w-16 py-1 text-xs text-center"
                disabled={!providerConfig.rotation?.enabled}
              />
              <span className="text-xs text-gray-400">hours</span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              {saved && <span className="text-xs text-green-400">Saved</span>}
              <button
                onClick={handleTestProvider}
                disabled={!providerConfig.username || !providerConfig.password || testingProvider || accounts.length === 0}
                className="btn-ghost border border-dark-500 px-3 py-1.5 text-xs disabled:opacity-40"
              >
                {testingProvider ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                onClick={handleApplyAll}
                disabled={!providerConfig.username || !providerConfig.password || applying}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                {applying ? 'Applying...' : 'Apply to All Accounts'}
              </button>
            </div>
          </div>
        )}

        {providerTestResult && (
          <div className={`mt-3 card ${providerTestResult.error ? 'border-red-600/40' : 'border-green-600/40'}`}>
            {providerTestResult.error ? (
              <p className="text-xs text-red-400">{providerTestResult.error}</p>
            ) : (
              <p className="text-xs text-green-400">
                Connected — IP: {providerTestResult.ip} | {providerTestResult.country}
                {providerTestResult.city && ` | ${providerTestResult.city}`}
                {providerTestResult.latency && ` | ${providerTestResult.latency}ms`}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Account Proxy Table */}
      <div className="card">
        <h3 className="text-sm font-semibold mb-3">Account Proxies</h3>
        {accounts.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">No accounts added yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-dark-600">
                  <th className="text-left py-2 px-2 font-medium">Account</th>
                  <th className="text-left py-2 px-2 font-medium">Status</th>
                  <th className="text-left py-2 px-2 font-medium">IP</th>
                  <th className="text-left py-2 px-2 font-medium">Country</th>
                  <th className="text-left py-2 px-2 font-medium">Latency</th>
                  <th className="text-left py-2 px-2 font-medium">Provider</th>
                  <th className="text-right py-2 px-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map(acct => {
                  const h = health[acct.id];
                  const hasProxy = acct.proxy?.host && acct.proxy?.port;
                  const isProvider = acct.proxy?.providerType && acct.proxy.providerType !== 'manual';

                  return (
                    <tr key={acct.id} className="border-b border-dark-700/50 hover:bg-dark-700/30 transition-colors">
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-dark-600 flex items-center justify-center text-xs font-bold overflow-hidden shrink-0">
                            {acct.avatar ? (
                              <img src={acct.avatar} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                            ) : (
                              (acct.name || '?')[0].toUpperCase()
                            )}
                          </div>
                          <span className="text-white text-xs font-medium truncate max-w-[120px]">{acct.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-2">
                        {hasProxy ? (
                          <div className="flex items-center gap-1.5">
                            <HealthDot status={h?.status} />
                            <span className={`text-xs ${
                              h?.status === 'healthy' ? 'text-green-400' :
                              h?.status === 'degraded' ? 'text-yellow-400' :
                              h?.status === 'dead' ? 'text-red-400' : 'text-gray-500'
                            }`}>
                              {h?.status || (acct.proxy?.enabled ? 'unchecked' : 'disabled')}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-600">no proxy</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-xs text-gray-400 font-mono">{h?.ip || '—'}</td>
                      <td className="py-2.5 px-2 text-xs text-gray-400">{h?.country || '—'}</td>
                      <td className="py-2.5 px-2 text-xs text-gray-400">{h?.latency != null ? `${h.latency}ms` : '—'}</td>
                      <td className="py-2.5 px-2 text-xs text-gray-400">{isProvider ? acct.proxy.providerType : hasProxy ? 'manual' : '—'}</td>
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-1 justify-end">
                          {hasProxy ? (
                            <>
                              <button
                                onClick={() => handleTestSingle(acct.id)}
                                disabled={testingId === acct.id}
                                className="px-2 py-1 rounded text-[10px] bg-dark-600 hover:bg-dark-500 text-gray-300 disabled:opacity-40 transition-colors"
                                title="Test proxy"
                              >
                                {testingId === acct.id ? '...' : 'Test'}
                              </button>
                              {isProvider && (
                                <button
                                  onClick={() => handleRotate(acct.id)}
                                  disabled={rotatingId === acct.id}
                                  className="px-2 py-1 rounded text-[10px] bg-dark-600 hover:bg-dark-500 text-gray-300 disabled:opacity-40 transition-colors"
                                  title="Rotate IP"
                                >
                                  {rotatingId === acct.id ? '...' : 'Rotate'}
                                </button>
                              )}
                              <button
                                onClick={() => handleToggle(acct.id)}
                                className={`px-2 py-1 rounded text-[10px] transition-colors ${
                                  acct.proxy?.enabled
                                    ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                                    : 'bg-dark-600 text-gray-500 hover:bg-dark-500'
                                }`}
                                title={acct.proxy?.enabled ? 'Disable proxy' : 'Enable proxy'}
                              >
                                {acct.proxy?.enabled ? 'ON' : 'OFF'}
                              </button>
                              <button
                                onClick={() => setEditAccount(acct)}
                                className="px-2 py-1 rounded text-[10px] bg-dark-600 hover:bg-dark-500 text-gray-300 transition-colors"
                                title="Edit proxy manually"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setDnsAccount(acct)}
                                className="px-2 py-1 rounded text-[10px] bg-dark-600 hover:bg-dark-500 text-gray-300 transition-colors"
                                title="DNS leak test"
                              >
                                DNS
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={async () => {
                                if (isProviderMode && providerConfig.username && providerConfig.password) {
                                  addToast('Assigning proxy...', 'info');
                                  await window.electronAPI.applyProviderProxy(acct.id);
                                  await refreshAccounts();
                                  addToast('Proxy assigned', 'success');
                                  handleTestSingle(acct.id);
                                } else {
                                  setEditAccount(acct);
                                }
                              }}
                              className="px-2.5 py-1 rounded text-[10px] bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
                            >
                              Configure
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {editAccount && (
        <ManualProxyModal
          account={editAccount}
          onClose={() => setEditAccount(null)}
          onSaved={async () => {
            setEditAccount(null);
            await refreshAccounts();
            addToast('Proxy saved', 'success');
          }}
        />
      )}
      {dnsAccount && (
        <DnsLeakModal
          account={dnsAccount}
          onClose={() => setDnsAccount(null)}
        />
      )}

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
