import { useState, useEffect, useRef } from 'react';
import './index.css';
import ProxySettingsView from './pages/ProxySettingsView';
import MassMessagesView from './pages/MassMessagesView';
import ChatsView from './pages/ChatsView';
import HomeView from './pages/HomeView';
import OFWebview from './components/OFWebview';
import { setApiKey, listAccounts as apiListAccounts } from './api';

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [activeId, _setActiveId] = useState(null);
  const [visitedIds, setVisitedIds] = useState(new Set());
  const [loginStatus, setLoginStatus] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const loginRefreshTimer = useRef(null);

  const refreshLoginStatus = () => {
    window.electronAPI?.checkAllLoginStatus().then(status => setLoginStatus(status)).catch(err => console.warn('Login status check failed:', err));
  };

  const setActiveId = (newId) => {
    if (activeId && activeId.startsWith('acct_') && activeId !== newId) {
      window.electronAPI.syncUploadAccount(activeId);
      // Refresh login status after uploading (detects new logins)
      clearTimeout(loginRefreshTimer.current);
      loginRefreshTimer.current = setTimeout(refreshLoginStatus, 1000);
    }
    if (newId && newId.startsWith('acct_')) {
      setVisitedIds(prev => {
        if (prev.has(newId)) return prev;
        const next = new Set(prev);
        next.add(newId);
        return next;
      });
    }
    _setActiveId(newId);
  };
  const [adding, setAdding] = useState(false);
  const [editName, setEditName] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [hoveredAcct, setHoveredAcct] = useState(null);
  const [apiAccounts, setApiAccounts] = useState([]);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ connected: false });

  // Only logged-in accounts appear in the sidebar
  const sidebarAccounts = accounts.filter(a => loginStatus[a.id]);

  const handleReorder = (draggedId, targetId) => {
    if (draggedId === targetId) return;
    const newAccounts = [...accounts];
    const dragIdx = newAccounts.findIndex(a => a.id === draggedId);
    const targetIdx = newAccounts.findIndex(a => a.id === targetId);
    if (dragIdx < 0 || targetIdx < 0) return;
    const [dragged] = newAccounts.splice(dragIdx, 1);
    const insertIdx = newAccounts.findIndex(a => a.id === targetId);
    newAccounts.splice(insertIdx, 0, dragged);
    setAccounts(newAccounts);
    window.electronAPI?.reorderAccounts(newAccounts);
  };

  const loadApiAccounts = async (key) => {
    if (!key) return;
    setApiKey(key);
    if (window.electronAPI) await window.electronAPI.setApiKey(key);
    const accts = await apiListAccounts();
    setApiKeySet(true);
    setApiAccounts(Array.isArray(accts) ? accts : accts?.data || []);
  };

  const handleSyncNow = async () => {
    try { await window.electronAPI?.syncNow(); } catch (err) { console.warn('Sync failed:', err); }
    refreshLoginStatus();
  };

  const handleFactoryReset = async () => {
    if (!confirm('This will delete ALL accounts and sync data across all devices. The app will restart. Continue?')) return;
    try { await window.electronAPI?.syncFactoryReset(); } catch (err) { console.warn('Factory reset failed:', err); }
    setAccounts([]);
    setLoginStatus({});
    _setActiveId(null);
    // Restart app to fully clear in-memory sessions
    window.electronAPI?.close();
  };

  useEffect(() => {
    if (window.electronAPI) {
      Promise.all([
        window.electronAPI.getAccounts().then((accts) => {
          setAccounts(accts || []);
        }),
        window.electronAPI.getApiKey().then((key) => {
          if (key) return loadApiAccounts(key).catch(err => console.warn('API key load failed:', err));
        }),
        window.electronAPI.syncStatus().then((s) => setSyncStatus(s || { connected: false })),
      ]).finally(() => setIsLoading(false));
      window.electronAPI.onSyncUpdate((status) => setSyncStatus(status));
      window.electronAPI.onSyncAccountsUpdated((accts) => {
        setAccounts(accts || []);
        refreshLoginStatus();
      });
      // Initial login status check (after sync has completed)
      const initTimer = setTimeout(refreshLoginStatus, 2000);
      return () => clearTimeout(initTimer);
    } else {
      setIsLoading(false);
    }
  }, []);

  const addAccount = async () => {
    const id = `acct_${Date.now()}`;
    const newAcct = { id, name: editName || `Account ${accounts.length + 1}` };
    try {
      const updated = await window.electronAPI?.saveAccount(newAcct);
      setAccounts(updated);
      setActiveId(id);
      setAdding(false);
      setEditName('');
    } catch (err) {
      console.error('Failed to add account:', err);
    }
  };

  const removeAccount = async (id) => {
    try {
      const updated = await window.electronAPI?.removeAccount(id);
      setAccounts(updated);
      if (activeId === id) setActiveId(null);
      setVisitedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setConfirmRemove(null);
    } catch (err) {
      console.error('Failed to remove account:', err);
    }
  };

  const toggleProxy = async (accountId) => {
    const acct = accounts.find((a) => a.id === accountId);
    if (!acct?.proxy) return;
    const updated = { ...acct.proxy, enabled: !acct.proxy.enabled };
    try {
      await window.electronAPI?.setProxy({ accountId, proxy: updated });
      const accts = await window.electronAPI?.getAccounts();
      setAccounts(accts || []);
    } catch (err) {
      console.error('Failed to toggle proxy:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-dark-900">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

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

        {/* Accounts — only logged-in accounts shown, draggable to reorder */}
        <div className="flex-1 flex flex-col items-center gap-1.5 py-1 overflow-y-auto w-full">
          {sidebarAccounts.map((acct) => (
            <div
              key={acct.id}
              className="relative group flex justify-center"
              draggable
              onDragStart={(e) => {
                setDragId(acct.id);
                e.dataTransfer.effectAllowed = 'move';
                e.currentTarget.style.opacity = '0.4';
              }}
              onDragEnd={(e) => {
                e.currentTarget.style.opacity = '1';
                setDragId(null);
                setDragOverId(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (acct.id !== dragId) setDragOverId(acct.id);
              }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== acct.id) handleReorder(dragId, acct.id);
                setDragId(null);
                setDragOverId(null);
              }}
            >
              {/* Drop indicator */}
              {dragOverId === acct.id && dragId !== acct.id && (
                <div className="absolute -top-[3px] left-2 right-2 h-[3px] bg-accent rounded-full z-10" />
              )}
              <button
                onClick={() => setActiveId(acct.id)}
                onMouseEnter={() => setHoveredAcct(acct)}
                onMouseLeave={() => { setHoveredAcct(null); setConfirmRemove(null); }}
                className={`w-[42px] h-[42px] rounded-full flex items-center justify-center text-sm font-bold transition-all shrink-0 cursor-grab active:cursor-grabbing ${
                  activeId === acct.id
                    ? 'ring-2 ring-accent ring-offset-2 ring-offset-dark-900 bg-dark-500 text-white'
                    : 'bg-dark-700 text-gray-400 hover:brightness-125'
                }`}
              >
                {(acct.name || '?')[0].toUpperCase()}
              </button>
              {acct.proxy?.enabled && (
                <div className="absolute bottom-0 right-1 w-3 h-3 rounded-full bg-green-500 border-2 border-dark-900" />
              )}
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
          <div className="relative w-9 h-9 flex items-center justify-center" title={syncStatus.connected ? `Auto-syncing${syncStatus.lastSync ? ' · ' + new Date(syncStatus.lastSync).toLocaleTimeString() : ''}` : 'Sync disconnected'}>
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
                onKeyDown={(e) => { if (e.key === 'Enter') addAccount(); if (e.key === 'Escape') { setAdding(false); setEditName(''); } }}
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
      <main className="flex-1 relative overflow-hidden">
        {/* Special views — mount/unmount normally */}
        {activeId === '__chats__' && <ChatsView apiAccounts={apiAccounts} />}
        {activeId === '__mass_messages__' && <MassMessagesView apiAccounts={apiAccounts} />}
        {activeId === '__proxy_settings__' && <ProxySettingsView accounts={accounts} />}
        {activeId === null && (
          <HomeView
            accounts={accounts}
            loginStatus={loginStatus}
            onSelect={setActiveId}
            onAdd={() => setAdding(true)}
            apiKeySet={apiKeySet}
            apiAccounts={apiAccounts}
            onApiKeyConnect={loadApiAccounts}
            syncStatus={syncStatus}
            onSyncNow={handleSyncNow}
            onFactoryReset={handleFactoryReset}
          />
        )}

        {/* Persistent account webviews — stay mounted once visited */}
        {[...visitedIds].map(id => {
          const acct = accounts.find(a => a.id === id);
          if (!acct) return null;
          return (
            <div key={id} className="absolute inset-0 flex flex-col" style={{ display: activeId === id ? 'flex' : 'none' }}>
              <OFWebview accountId={id} proxy={acct?.proxy} onToggleProxy={() => toggleProxy(id)} isActive={activeId === id} />
            </div>
          );
        })}
      </main>
      </div>
    </div>
  );
}
