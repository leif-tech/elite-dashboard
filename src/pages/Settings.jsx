import { useState, useEffect } from 'react';
import { setApiKey, getApiKey, whoami } from '../api';

export default function Settings({ onKeySaved }) {
  const [key, setKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null); // { ok, msg }
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setKey(getApiKey() || '');
  }, []);

  const handleTest = async () => {
    if (!key.trim()) return;
    setTesting(true);
    setResult(null);
    try {
      const data = await (async () => {
        // Temporarily set key for test
        const old = getApiKey();
        setApiKey(key.trim());
        try {
          return await whoami();
        } catch (e) {
          setApiKey(old);
          throw e;
        }
      })();
      setResult({ ok: true, msg: `Connected! Team: ${data.team?.name || data.name || 'OK'}` });
    } catch (e) {
      setResult({ ok: false, msg: e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setApiKey(trimmed);
    if (window.electronAPI) {
      await window.electronAPI.setApiKey(trimmed);
    }
    onKeySaved(trimmed);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-lg">
      <h2 className="text-xl font-bold mb-1">Settings</h2>
      <p className="text-sm text-gray-500 mb-6">Configure your OnlyFansAPI connection.</p>

      <div className="card space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">API Key</label>
          <input
            className="input font-mono text-sm"
            placeholder="Paste your OnlyFansAPI key..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <p className="text-xs text-gray-600 mt-1.5">
            Get your key at app.onlyfansapi.com/api-keys
          </p>
        </div>

        {result && (
          <div
            className={`rounded-lg p-3 text-sm ${
              result.ok
                ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}
          >
            {result.msg}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={handleTest} disabled={testing || !key.trim()} className="btn-ghost">
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <button onClick={handleSave} disabled={!key.trim()} className="btn-primary">
            {saved ? 'Saved!' : 'Save Key'}
          </button>
        </div>
      </div>
    </div>
  );
}
