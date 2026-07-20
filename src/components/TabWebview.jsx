import { useState, useEffect, useRef } from 'react';

export default function TabWebview({ accountId, tabId, initialUrl, isActive, proxy, onToggleProxy, onTitleChange }) {
  const webviewRef = useRef(null);
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
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

  return (
    <div className={`flex flex-col ${isActive ? 'flex-1' : 'hidden'}`}>
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
