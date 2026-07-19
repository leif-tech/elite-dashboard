import { useState, useEffect, useRef } from 'react';
import './index.css';
import ProxySettingsView from './pages/ProxySettingsView';
import MassMessagesView from './pages/MassMessagesView';
import ChatsView from './pages/ChatsView';
import { setApiKey, getApiKey, listAccounts as apiListAccounts } from './api';

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [activeId, setActiveId] = useState(null); // null = home, string = account id, __proxy__ / __mass_messages__
  const [adding, setAdding] = useState(false);
  const [editName, setEditName] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [hoveredAcct, setHoveredAcct] = useState(null);
  const [apiAccounts, setApiAccounts] = useState([]);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ connected: false });

  const loadApiAccounts = async (key) => {
    if (!key) return;
    setApiKey(key);
    const accts = await apiListAccounts(); // throws on invalid key
    if (window.electronAPI) await window.electronAPI.setApiKey(key);
    setApiKeySet(true);
    setApiAccounts(Array.isArray(accts) ? accts : accts?.data || []);
  };

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getAccounts().then((accts) => {
        setAccounts(accts || []);
      });
      window.electronAPI.getApiKey().then((key) => {
        if (key) loadApiAccounts(key).catch(() => {});
      });
      // Sync status
      window.electronAPI.syncStatus().then((s) => setSyncStatus(s || { connected: false }));
      window.electronAPI.onSyncUpdate((status) => setSyncStatus(status));
      window.electronAPI.onSyncAccountsUpdated((accts) => setAccounts(accts || []));
    }
  }, []);

  const addAccount = async () => {
    const id = `acct_${Date.now()}`;
    const newAcct = { id, name: editName || `Account ${accounts.length + 1}` };
    const updated = await window.electronAPI.saveAccount(newAcct);
    setAccounts(updated);
    setActiveId(id);
    setAdding(false);
    setEditName('');
  };

  const removeAccount = async (id) => {
    const updated = await window.electronAPI.removeAccount(id);
    setAccounts(updated);
    if (activeId === id) setActiveId(null);
    setConfirmRemove(null);
  };

  const active = accounts.find((a) => a.id === activeId);

  const toggleProxy = async (accountId) => {
    const acct = accounts.find((a) => a.id === accountId);
    if (!acct?.proxy) return;
    const updated = { ...acct.proxy, enabled: !acct.proxy.enabled };
    await window.electronAPI.setProxy({ accountId, proxy: updated });
    const accts = await window.electronAPI.getAccounts();
    setAccounts(accts || []);
  };

  // Determine main content
  const renderMain = () => {
    if (activeId === '__chats__') {
      return <ChatsView apiAccounts={apiAccounts} />;
    }
    if (activeId === '__mass_messages__') {
      return <MassMessagesView apiAccounts={apiAccounts} />;
    }
    if (activeId === '__proxy_settings__') {
      return <ProxySettingsView accounts={accounts} />;
    }
    if (activeId === null) {
      return <HomeView accounts={accounts} onSelect={setActiveId} onAdd={() => setAdding(true)} apiKeySet={apiKeySet} apiAccounts={apiAccounts} onApiKeyConnect={loadApiAccounts} syncStatus={syncStatus} />;
    }
    const acct = accounts.find((a) => a.id === activeId);
    return <OFWebview accountId={activeId} proxy={acct?.proxy} onToggleProxy={() => toggleProxy(activeId)} />;
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Draggable titlebar */}
      <div
        className="h-9 bg-dark-900 flex items-center justify-between px-3 shrink-0 select-none"
        style={{ WebkitAppRegion: 'drag' }}
      >
        <span className="text-xs text-gray-600 font-medium">Elite Dashboard</span>
        <div className="flex" style={{ WebkitAppRegion: 'no-drag' }}>
          <button
            onClick={() => window.electronAPI?.minimize()}
            className="w-10 h-9 flex items-center justify-center text-gray-500 hover:text-white hover:bg-dark-600 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5" width="12" height="1.5" fill="currentColor" rx="0.5"/></svg>
          </button>
          <button
            onClick={() => window.electronAPI?.maximize()}
            className="w-10 h-9 flex items-center justify-center text-gray-500 hover:text-white hover:bg-dark-600 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" rx="1"/></svg>
          </button>
          <button
            onClick={() => window.electronAPI?.close()}
            className="w-10 h-9 flex items-center justify-center text-gray-500 hover:text-white hover:bg-red-600 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
      {/* Compact icon sidebar */}
      <aside className="w-[56px] bg-dark-900 flex flex-col items-center shrink-0 border-r border-dark-700">
        {/* Brand / Home */}
        <button
          onClick={() => setActiveId(null)}
          className={`w-full py-3 flex items-center justify-center transition-colors ${
            activeId === null ? 'text-accent' : 'text-gray-500 hover:text-white'
          }`}
          title="Home"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
        </button>

        {/* Accounts — main section */}
        <div className="flex-1 flex flex-col items-center gap-1.5 py-1 overflow-y-auto w-full">
          {accounts.map((acct) => (
            <div key={acct.id} className="relative group flex justify-center">
              <button
                onClick={() => setActiveId(acct.id)}
                onMouseEnter={() => setHoveredAcct(acct)}
                onMouseLeave={() => { setHoveredAcct(null); setConfirmRemove(null); }}
                className={`w-[42px] h-[42px] rounded-full flex items-center justify-center text-sm font-bold transition-all shrink-0 ${
                  activeId === acct.id
                    ? 'ring-2 ring-accent ring-offset-2 ring-offset-dark-900 bg-dark-500 text-white'
                    : 'bg-dark-700 text-gray-400 hover:brightness-125'
                }`}
              >
                {(acct.name || '?')[0].toUpperCase()}
              </button>
              {/* Proxy dot */}
              {acct.proxy?.enabled && (
                <div className="absolute bottom-0 right-1 w-3 h-3 rounded-full bg-green-500 border-2 border-dark-900" />
              )}
              {/* Remove button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirmRemove === acct.id) removeAccount(acct.id);
                  else setConfirmRemove(acct.id);
                }}
                className="absolute -top-1 -right-0.5 w-4 h-4 bg-red-600 rounded-full text-[9px] text-white items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hidden group-hover:flex"
                title={confirmRemove === acct.id ? 'Click again to confirm' : 'Remove account'}
              >
                &times;
              </button>
            </div>
          ))}

          {/* Add account button — cyan circle */}
          <button
            onClick={() => setAdding(true)}
            className="w-[42px] h-[42px] rounded-full bg-accent hover:bg-accent-hover flex items-center justify-center transition-colors shrink-0 mt-1"
            title="Add Account"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        {/* Tool icons at bottom */}
        <div className="flex flex-col items-center gap-1 py-2 border-t border-dark-700 w-full">
          {/* Sync status indicator */}
          <div className="relative w-9 h-9 flex items-center justify-center" title={syncStatus.connected ? `Synced${syncStatus.lastSync ? ' · ' + new Date(syncStatus.lastSync).toLocaleTimeString() : ''}` : 'Sync disconnected'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={syncStatus.connected ? 'text-gray-400' : 'text-gray-700'}>
              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
            </svg>
            <div className={`absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full border border-dark-900 ${syncStatus.connected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
          <button
            onClick={() => setActiveId('__chats__')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
              activeId === '__chats__' ? 'text-accent' : 'text-gray-600 hover:text-white'
            }`}
            title="Messages"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          <button
            onClick={() => setActiveId('__mass_messages__')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
              activeId === '__mass_messages__' ? 'text-accent' : 'text-gray-600 hover:text-white'
            }`}
            title="Mass Messages"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
            </svg>
          </button>
          <button
            onClick={() => setActiveId('__proxy_settings__')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
              activeId === '__proxy_settings__' ? 'text-accent' : 'text-gray-600 hover:text-white'
            }`}
            title="Proxy Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
            </svg>
          </button>
        </div>

        {/* Hovered account info */}
        {hoveredAcct && (
          <div className="border-t border-dark-700 px-1 py-2 flex flex-col items-center gap-0.5 shrink-0 w-full">
            <p className="text-[10px] font-semibold text-white text-center leading-tight truncate w-full">{hoveredAcct.name}</p>
            {hoveredAcct.username && (
              <p className="text-[9px] text-gray-500 text-center leading-tight truncate w-full">{hoveredAcct.username}</p>
            )}
          </div>
        )}

        {/* Add account modal */}
        {adding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setAdding(false); setEditName(''); }}>
            <div className="bg-dark-800 border border-dark-500 rounded-xl p-5 w-72 space-y-3" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-semibold">Add Account</h3>
              <input
                className="input w-full text-sm py-2"
                placeholder="Account name..."
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && addAccount()}
              />
              <div className="flex gap-2">
                <button onClick={addAccount} className="btn-primary text-xs py-2 flex-1">Add</button>
                <button onClick={() => { setAdding(false); setEditName(''); }} className="btn-ghost text-xs py-2 flex-1">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 relative">
        {renderMain()}
      </main>
      </div>
    </div>
  );
}

// Home / landing page
function HomeView({ accounts, onSelect, onAdd, apiKeySet, apiAccounts, onApiKeyConnect, syncStatus }) {
  const [keyInput, setKeyInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);

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
                  ? `Connected${syncStatus.lastSync ? ' · Last sync: ' + new Date(syncStatus.lastSync).toLocaleTimeString() : ''}`
                  : syncStatus.error || 'Disconnected'}
              </p>
            </div>
            <div className={`w-3 h-3 rounded-full ${syncStatus.connected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setSyncing(true);
                try { await window.electronAPI?.syncForce(); } catch {}
                setSyncing(false);
              }}
              disabled={syncing}
              className="btn-ghost text-xs py-1.5 px-3 disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : 'Force Upload'}
            </button>
            <button
              onClick={async () => {
                setSyncing(true);
                try { await window.electronAPI?.syncDownload(); } catch {}
                setSyncing(false);
              }}
              disabled={syncing}
              className="btn-ghost text-xs py-1.5 px-3 disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : 'Force Download'}
            </button>
            {syncStatus.accounts > 0 && (
              <span className="text-xs text-gray-500 ml-auto">{syncStatus.accounts} account{syncStatus.accounts !== 1 ? 's' : ''} synced</span>
            )}
          </div>
        </div>
      )}

      {/* Browser Accounts */}
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Browser Accounts</h3>
      {accounts.length === 0 ? (
        <div className="card text-center py-12 max-w-md mx-auto">
          <div className="text-4xl mb-4 text-gray-600">+</div>
          <p className="text-gray-400 mb-2">No browser accounts yet.</p>
          <p className="text-sm text-gray-600 mb-4">Add an account to browse OnlyFans directly.</p>
          <button onClick={onAdd} className="btn-primary">Add Account</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map((acct) => (
            <button
              key={acct.id}
              onClick={() => onSelect(acct.id)}
              className="card hover:border-accent/40 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-dark-500 flex items-center justify-center text-lg font-bold text-gray-400">
                  {(acct.name || '?')[0].toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold">{acct.name}</p>
                  <p className="text-xs text-gray-500">Click to open OnlyFans</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Embedded OF browser per account — with tabs
function OFWebview({ accountId, proxy, onToggleProxy }) {
  const [tabs, setTabs] = useState([{ id: 1, title: 'OnlyFans', url: 'https://onlyfans.com' }]);
  const [activeTab, setActiveTab] = useState(1);
  const nextId = useRef(2);

  // Listen for "Open in New Tab" from main process context menu
  useEffect(() => {
    if (!window.electronAPI?.onOpenNewTab) return;
    const handler = (url) => {
      const id = nextId.current++;
      setTabs((prev) => [...prev, { id, title: 'Loading...', url }]);
      setActiveTab(id);
    };
    window.electronAPI.onOpenNewTab(handler);
  }, []);

  // Reset tabs when switching accounts
  useEffect(() => {
    setTabs([{ id: 1, title: 'OnlyFans', url: 'https://onlyfans.com' }]);
    setActiveTab(1);
    nextId.current = 2;
  }, [accountId]);

  const closeTab = (id) => {
    const filtered = tabs.filter((t) => t.id !== id);
    if (filtered.length === 0) {
      setTabs([{ id: 1, title: 'OnlyFans', url: 'https://onlyfans.com' }]);
      setActiveTab(1);
    } else {
      setTabs(filtered);
      if (activeTab === id) setActiveTab(filtered[filtered.length - 1].id);
    }
  };

  const addTab = () => {
    const id = nextId.current++;
    setTabs((prev) => [...prev, { id, title: 'New Tab', url: 'https://onlyfans.com' }]);
    setActiveTab(id);
  };

  const updateTabTitle = (id, title) => {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, title } : t));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar — only show when more than 1 tab */}
      {tabs.length > 1 && (
        <div className="flex items-center bg-dark-900 border-b border-dark-600 px-1 shrink-0">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`group flex items-center gap-1.5 max-w-[180px] px-3 py-1.5 text-xs cursor-pointer border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-accent text-white bg-dark-800'
                  : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-dark-800/50'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="truncate">{tab.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              >
                &times;
              </button>
            </div>
          ))}
          <button
            onClick={addTab}
            className="px-2 py-1.5 text-gray-600 hover:text-white transition-colors text-sm"
            title="New tab"
          >
            +
          </button>
        </div>
      )}

      {/* Render all tabs, only show active */}
      {tabs.map((tab) => (
        <TabWebview
          key={`${accountId}-${tab.id}`}
          accountId={accountId}
          tabId={tab.id}
          initialUrl={tab.url}
          isActive={activeTab === tab.id}
          proxy={proxy}
          onToggleProxy={onToggleProxy}
          onTitleChange={(title) => updateTabTitle(tab.id, title)}
        />
      ))}
    </div>
  );
}

// Single tab's webview + toolbar
function TabWebview({ accountId, tabId, initialUrl, isActive, proxy, onToggleProxy, onTitleChange }) {
  const webviewRef = useRef(null);
  const [url, setUrl] = useState(initialUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onNavigation = () => {
      const currentUrl = wv.getURL();
      setUrl(currentUrl);
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());
    };

    const onStartLoad = () => setLoading(true);
    const onStopLoad = () => {
      setLoading(false);
      onNavigation();
      // Update tab title from page title
      try {
        const title = wv.getTitle();
        if (title) onTitleChange(title.length > 25 ? title.slice(0, 25) + '...' : title);
      } catch {}
    };

    wv.addEventListener('did-navigate', onNavigation);
    wv.addEventListener('did-navigate-in-page', onNavigation);
    wv.addEventListener('did-start-loading', onStartLoad);
    wv.addEventListener('did-stop-loading', onStopLoad);

    return () => {
      wv.removeEventListener('did-navigate', onNavigation);
      wv.removeEventListener('did-navigate-in-page', onNavigation);
      wv.removeEventListener('did-start-loading', onStartLoad);
      wv.removeEventListener('did-stop-loading', onStopLoad);
    };
  }, [tabId]);

  const goBack = () => webviewRef.current?.goBack();
  const goForward = () => webviewRef.current?.goForward();
  const reload = () => webviewRef.current?.reload();
  const goHome = () => webviewRef.current?.loadURL('https://onlyfans.com');

  return (
    <div className={`flex flex-col ${isActive ? 'flex-1' : 'hidden'}`}>
      {/* Browser toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-dark-800 border-b border-dark-600">
        <button onClick={goBack} disabled={!canGoBack} className="p-1.5 rounded hover:bg-dark-600 disabled:opacity-30 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <button onClick={goForward} disabled={!canGoForward} className="p-1.5 rounded hover:bg-dark-600 disabled:opacity-30 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
        <button onClick={reload} className="p-1.5 rounded hover:bg-dark-600 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? 'animate-spin' : ''}>
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
        <button onClick={goHome} className="p-1.5 rounded hover:bg-dark-600 transition-colors" title="OnlyFans Home">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        </button>

        <div className="flex-1 bg-dark-900 rounded-lg px-3 py-1.5 text-xs text-gray-500 truncate border border-dark-600">
          {url}
        </div>

        {proxy && (
          <button
            onClick={onToggleProxy}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              proxy.enabled
                ? 'border-green-600/40 text-green-400 hover:bg-green-600/10'
                : 'border-dark-500 text-gray-500 hover:bg-dark-600'
            }`}
            title={proxy.enabled ? 'Proxy active — click to disable' : 'Proxy disabled — click to enable'}
          >
            <div className={`w-2 h-2 rounded-full ${proxy.enabled ? 'bg-green-500' : 'bg-gray-600'}`} />
            {proxy.enabled ? 'Proxy ON' : 'Proxy OFF'}
          </button>
        )}
      </div>

      <webview
        ref={webviewRef}
        src={initialUrl}
        partition={`persist:of-${accountId}`}
        useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        className="flex-1"
        style={{ width: '100%', height: '100%' }}
        allowpopups="true"
      />
    </div>
  );
}
