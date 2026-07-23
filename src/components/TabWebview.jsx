import { useState, useEffect, useRef } from 'react';

export default function TabWebview({ accountId, tabId, initialUrl, isActive, proxy, onToggleProxy, proxyHealth, onTitleChange }) {
  const webviewRef = useRef(null);
  const urlInputRef = useRef(null);
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  const [url, setUrl] = useState(initialUrl);
  const [urlInput, setUrlInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);

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
      try {
        const title = wv.getTitle();
        if (title) onTitleChangeRef.current(title.length > 25 ? title.slice(0, 25) + '...' : title);
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

  const startEditing = () => {
    setUrlInput(url);
    setEditing(true);
    setTimeout(() => urlInputRef.current?.select(), 0);
  };

  const navigate = () => {
    let target = urlInput.trim();
    if (!target) { setEditing(false); return; }
    if (!/^https?:\/\//i.test(target)) {
      if (/^[a-zA-Z0-9].*\.[a-zA-Z]{2,}/.test(target)) {
        target = 'https://' + target;
      } else {
        target = 'https://www.google.com/search?q=' + encodeURIComponent(target);
      }
    }
    webviewRef.current?.loadURL(target);
    setEditing(false);
  };

  const NavBtn = ({ onClick, disabled, title, children }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
    >
      {children}
    </button>
  );

  // Extract display URL — show domain prominently
  const displayUrl = (() => {
    try {
      const u = new URL(url);
      return { protocol: u.protocol + '//', host: u.host, path: u.pathname + u.search + u.hash };
    } catch {
      return null;
    }
  })();

  return (
    <div className={`flex flex-col ${isActive ? 'flex-1' : 'hidden'}`}>
      {/* Nav bar */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-dark-800 border-b border-dark-700/50">
        <NavBtn onClick={goBack} disabled={!canGoBack} title="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </NavBtn>
        <NavBtn onClick={goForward} disabled={!canGoForward} title="Forward">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </NavBtn>
        <NavBtn onClick={reload} title="Reload">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'animate-spin' : ''}>
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </NavBtn>
        <NavBtn onClick={goHome} title="OnlyFans Home">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        </NavBtn>

        {/* URL bar */}
        {editing ? (
          <input
            ref={urlInputRef}
            className="flex-1 bg-dark-700 rounded-full px-4 py-1.5 text-xs text-white border border-accent/60 outline-none placeholder-gray-600 mx-1"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') navigate();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={() => setEditing(false)}
            placeholder="Search or enter URL"
            autoFocus
          />
        ) : (
          <div
            onClick={startEditing}
            className="flex-1 bg-dark-700/60 hover:bg-dark-700 rounded-full px-4 py-1.5 text-xs truncate cursor-text transition-colors mx-1 flex items-center gap-0.5"
          >
            {displayUrl ? (
              <>
                <span className="text-gray-600">{displayUrl.protocol}</span>
                <span className="text-gray-300">{displayUrl.host}</span>
                <span className="text-gray-600">{displayUrl.path !== '/' ? displayUrl.path : ''}</span>
              </>
            ) : (
              <span className="text-gray-500">{url}</span>
            )}
          </div>
        )}

        {/* Proxy controls */}
        {proxy && (
          <div className="flex items-center gap-1 ml-1">
            {proxy.providerType && proxy.providerType !== 'manual' && proxy.enabled && (
              <button
                onClick={async () => {
                  setRotating(true);
                  await window.electronAPI?.rotateProxy(accountId);
                  setRotating(false);
                }}
                disabled={rotating}
                className="h-7 px-2.5 rounded-full text-[11px] text-gray-400 hover:text-white hover:bg-white/5 border border-dark-600 transition-colors disabled:opacity-40 flex items-center gap-1"
                title="Rotate IP"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
                {rotating ? '...' : 'Rotate'}
              </button>
            )}
            <button
              onClick={onToggleProxy}
              className={`h-7 flex items-center gap-1.5 px-2.5 rounded-full text-[11px] font-medium transition-colors ${
                proxy.enabled
                  ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                  : 'bg-dark-600/50 text-gray-500 hover:bg-dark-600'
              }`}
              title={proxy.enabled ? 'Proxy active — click to disable' : 'Proxy disabled — click to enable'}
            >
              <div className={`w-2 h-2 rounded-full ${
                proxyHealth?.status === 'healthy' ? 'bg-green-400' :
                proxyHealth?.status === 'degraded' ? 'bg-yellow-400' :
                proxyHealth?.status === 'dead' ? 'bg-red-400' :
                proxy.enabled ? 'bg-green-400' : 'bg-gray-600'
              }`} />
              {proxy.enabled ? 'Proxy' : 'No Proxy'}
            </button>
          </div>
        )}
      </div>

      <webview
        ref={webviewRef}
        src={initialUrl}
        partition={`persist:of-${accountId}`}
        className="flex-1"
        style={{ width: '100%', height: '100%' }}
        allowpopups="true"
      />
    </div>
  );
}
