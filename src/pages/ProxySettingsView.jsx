import { useState, useEffect } from 'react';

export default function ProxySettingsView({ accounts }) {
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({
    enabled: true,
    protocol: 'http',
    host: '',
    port: '',
    username: '',
    password: '',
  });
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load proxy when account changes
  useEffect(() => {
    if (!selectedId) return;
    const api = window.electronAPI;
    if (api?.getProxy) {
      api.getProxy(selectedId).then((proxy) => {
        if (proxy) {
          setForm(proxy);
        } else {
          setForm({ enabled: true, protocol: 'http', host: '', port: '', username: '', password: '' });
        }
        setTestResult(null);
        setSaved(false);
      }).catch(() => {});
    } else {
      setForm({ enabled: true, protocol: 'http', host: '', port: '', username: '', password: '' });
      setTestResult(null);
      setSaved(false);
    }
  }, [selectedId]);

  const updateField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const handleTest = async () => {
    if (!form.host || !form.port) return;
    setTesting(true);
    setTestResult(null);
    const api = window.electronAPI;
    if (!api?.testProxy) { setTesting(false); return; }
    const result = await api.testProxy({ proxy: form });
    setTestResult(result);
    setTesting(false);
  };

  const handleSave = async () => {
    if (!selectedId) return;
    const api = window.electronAPI;
    if (!api?.setProxy) return;
    setSaving(true);
    await api.setProxy({ accountId: selectedId, proxy: form });
    setSaving(false);
    setSaved(true);
  };

  const handleClear = async () => {
    if (!selectedId) return;
    const api = window.electronAPI;
    const cleared = { enabled: false, protocol: 'http', host: '', port: '', username: '', password: '' };
    setForm(cleared);
    if (api?.setProxy) await api.setProxy({ accountId: selectedId, proxy: cleared });
    setTestResult(null);
    setSaved(false);
  };

  return (
    <div className="p-8 overflow-y-auto h-full">
      <h2 className="text-xl font-bold mb-1">Proxy Settings</h2>
      <p className="text-sm text-gray-500 mb-6">Configure per-account proxy so each model browses from a different IP.</p>

      {/* Account selector */}
      <div className="max-w-lg space-y-5">
        <div>
          <label className="block text-sm text-gray-400 mb-1.5">Account</label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="input w-full py-2"
          >
            <option value="">Select an account...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {selectedId && (
          <>
            {/* Enable toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => updateField('enabled', e.target.checked)}
                className="w-4 h-4 accent-accent"
              />
              <span className="text-sm">Enable proxy for this account</span>
            </label>

            {/* Protocol */}
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Protocol</label>
              <select
                value={form.protocol}
                onChange={(e) => updateField('protocol', e.target.value)}
                className="input w-full py-2"
              >
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </div>

            {/* Host + Port */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm text-gray-400 mb-1.5">Host</label>
                <input
                  className="input w-full py-2"
                  placeholder="123.45.67.89"
                  value={form.host}
                  onChange={(e) => updateField('host', e.target.value)}
                />
              </div>
              <div className="w-28">
                <label className="block text-sm text-gray-400 mb-1.5">Port</label>
                <input
                  className="input w-full py-2"
                  placeholder="8080"
                  value={form.port}
                  onChange={(e) => updateField('port', e.target.value)}
                />
              </div>
            </div>

            {/* Auth */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm text-gray-400 mb-1.5">Username (optional)</label>
                <input
                  className="input w-full py-2"
                  placeholder="username"
                  value={form.username}
                  onChange={(e) => updateField('username', e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm text-gray-400 mb-1.5">Password (optional)</label>
                <input
                  className="input w-full py-2"
                  type="password"
                  placeholder="password"
                  value={form.password}
                  onChange={(e) => updateField('password', e.target.value)}
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleTest}
                disabled={!form.host || !form.port || testing}
                className="btn-ghost border border-dark-500 px-4 py-2 text-sm disabled:opacity-40"
              >
                {testing ? 'Testing...' : 'Test Proxy'}
              </button>
              <button
                onClick={handleSave}
                disabled={!form.host || !form.port || saving}
                className="btn-primary px-4 py-2 text-sm"
              >
                {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
              </button>
              <button
                onClick={handleClear}
                className="btn-ghost text-red-400 hover:text-red-300 px-4 py-2 text-sm"
              >
                Clear
              </button>
            </div>

            {/* Test result */}
            {testResult && (
              <div className={`card mt-2 ${testResult.success ? 'border-green-600/40' : 'border-red-600/40'}`}>
                {testResult.success ? (
                  <div className="space-y-1">
                    <p className="text-sm text-green-400 font-medium">Proxy working</p>
                    <p className="text-xs text-gray-400">
                      IP: <span className="text-white">{testResult.ip}</span>
                      {' '} | Country: <span className="text-white">{testResult.country}</span>
                      {testResult.city && <> | City: <span className="text-white">{testResult.city}</span></>}
                      {' '} | Latency: <span className="text-white">{testResult.latency}ms</span>
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-red-400 font-medium">Connection failed</p>
                    <p className="text-xs text-gray-500">{testResult.error}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
