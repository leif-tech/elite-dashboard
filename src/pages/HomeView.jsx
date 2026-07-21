import { useState } from 'react';

export default function HomeView({ accounts, loginStatus, avatars, onSelect, onAdd, onRemove, onRename, apiKeySet, apiAccounts, onApiKeyConnect, syncStatus, onSyncNow, onFactoryReset }) {
  const [keyInput, setKeyInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const handleConnect = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setConnecting(true);
    setError('');
    try {
      await onApiKeyConnect(trimmed);
      setKeyInput('');
    } catch (e) {
      setError('Invalid API key. Check your key and try again.');
    }
    setConnecting(false);
  };

  return (
    <div className="p-8 overflow-y-auto h-full">
      <h2 className="text-xl font-bold mb-1">Welcome</h2>
      <p className="text-sm text-gray-500 mb-6">Select an account from the sidebar to browse OnlyFans, or add a new one.</p>

      {/* API Key Setup / Connected Models */}
      {!apiKeySet ? (
        <div className="card max-w-lg mb-8 p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-sm">Connect Your API</h3>
              <p className="text-xs text-gray-500">Share this key with your team to sync model accounts</p>
            </div>
          </div>
          <input
            className="input w-full text-sm py-2.5 mb-2"
            placeholder="Paste your OnlyFansAPI key..."
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            type="password"
          />
          {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
          <div className="flex items-center justify-between">
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal('https://app.onlyfansapi.com/api-keys'); }}
              className="text-xs text-accent hover:underline"
            >
              Get your key at app.onlyfansapi.com
            </a>
            <button
              onClick={handleConnect}
              disabled={!keyInput.trim() || connecting}
              className="btn-primary text-xs py-2 px-4 disabled:opacity-50"
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <h3 className="text-sm font-semibold text-gray-300">Connected Models</h3>
            <span className="text-xs text-gray-600">({apiAccounts.length})</span>
          </div>
          {apiAccounts.length > 0 ? (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
              {apiAccounts.map((acct) => (
                <div key={acct.id} className="card p-4 flex items-center gap-3">
                  {acct.avatar ? (
                    <img src={acct.avatar} className="w-10 h-10 rounded-full object-cover" alt="" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-sm font-bold text-accent">
                      {(acct.display_name || acct.onlyfans_username || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{acct.display_name || acct.onlyfans_username || acct.id}</p>
                    {acct.onlyfans_username && (
                      <p className="text-xs text-gray-500 truncate">@{acct.onlyfans_username}</p>
                    )}
                  </div>
                  <div className="ml-auto">
                    <div className={`w-2.5 h-2.5 rounded-full ${acct.is_active !== false ? 'bg-green-500' : 'bg-yellow-500'}`} title={acct.is_active !== false ? 'Active' : 'Inactive'} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">API connected but no model accounts found. Connect models at app.onlyfansapi.com.</p>
          )}
        </div>
      )}

      {/* Session Sync Card */}
      {apiKeySet && (
        <div className="card max-w-lg mb-8 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${syncStatus.connected ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={syncStatus.connected ? 'text-green-400' : 'text-red-400'}>
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-sm">Session Sync</h3>
              <p className="text-xs text-gray-500">
                {syncStatus.connected
                  ? `Auto-syncing every 30s${syncStatus.lastSync ? ' · Last: ' + new Date(syncStatus.lastSync).toLocaleTimeString() : ''}${syncStatus.accounts ? ' · ' + syncStatus.accounts + ' accounts' : ''}`
                  : syncStatus.error || 'Disconnected'}
              </p>
            </div>
            <div className={`w-3 h-3 rounded-full ${syncStatus.connected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setSyncing(true);
                try { await onSyncNow(); } catch {}
                setSyncing(false);
              }}
              disabled={syncing}
              className="btn-ghost text-xs py-1.5 px-3 disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <button
              onClick={async () => {
                setSyncing(true);
                try { await onFactoryReset(); } catch {}
                setSyncing(false);
              }}
              disabled={syncing}
              className="btn-ghost text-xs py-1.5 px-3 text-red-500 disabled:opacity-50"
            >
              Factory Reset
            </button>
          </div>
        </div>
      )}

      {/* Browser Accounts — only show logged-in accounts */}
      {(() => {
        const loggedInAccounts = accounts.filter(a => loginStatus?.[a.id]);
        return (
          <>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Browser Accounts</h3>
            {loggedInAccounts.length === 0 ? (
              <div className="card text-center py-12 max-w-md mx-auto">
                <div className="text-4xl mb-4 text-gray-600">+</div>
                <p className="text-gray-400 mb-2">No logged-in browser accounts.</p>
                <p className="text-sm text-gray-600 mb-4">Add an account and log in to OnlyFans to see it here.</p>
                <button onClick={onAdd} className="btn-primary">Add Account</button>
              </div>
            ) : (
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                {loggedInAccounts.map((acct) => (
            <div key={acct.id} className="card hover:border-accent/40 transition-colors text-left relative group">
              <button
                onClick={() => renamingId === acct.id ? null : onSelect(acct.id)}
                className="w-full text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-dark-500 flex items-center justify-center text-lg font-bold text-gray-400 overflow-hidden shrink-0">
                    {avatars?.[acct.id] ? (
                      <img src={avatars[acct.id]} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                    ) : (
                      (acct.name || '?')[0].toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    {renamingId === acct.id ? (
                      <input
                        className="input text-sm py-1 px-2 w-full"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { onRename(acct.id, renameValue); setRenamingId(null); }
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onBlur={() => { if (renameValue.trim()) onRename(acct.id, renameValue); setRenamingId(null); }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <>
                        <p className="font-semibold truncate">{acct.name}</p>
                        <p className="text-xs text-gray-500">Click to open OnlyFans</p>
                      </>
                    )}
                  </div>
                </div>
              </button>
              {/* Action buttons — show on hover */}
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenameValue(acct.name || '');
                    setRenamingId(acct.id);
                  }}
                  className="px-2 py-1 rounded text-xs text-gray-600 hover:text-accent"
                  title="Rename account"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirmRemoveId === acct.id) { onRemove(acct.id); setConfirmRemoveId(null); }
                    else setConfirmRemoveId(acct.id);
                  }}
                  onMouseLeave={() => setConfirmRemoveId(null)}
                  className={`px-2 py-1 rounded text-xs transition-all ${
                    confirmRemoveId === acct.id
                      ? 'bg-red-600 text-white'
                      : 'text-gray-600 hover:text-red-400'
                  }`}
                  title={confirmRemoveId === acct.id ? 'Click again to confirm' : 'Remove account'}
                >
                  {confirmRemoveId === acct.id ? 'Confirm?' : '✕'}
                </button>
              </div>
            </div>
              ))}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
