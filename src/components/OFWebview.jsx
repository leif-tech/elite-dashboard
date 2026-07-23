import { useState, useEffect, useRef } from 'react';
import TabWebview from './TabWebview';

export default function OFWebview({ accountId, proxy, onToggleProxy, isActive, proxyHealth }) {
  const [tabs, setTabs] = useState([{ id: 1, title: 'OnlyFans', url: 'https://onlyfans.com' }]);
  const [activeTab, setActiveTab] = useState(1);
  const nextId = useRef(2);

  useEffect(() => {
    if (!isActive || !window.electronAPI?.onOpenNewTab) return;
    const handler = (url) => {
      const id = nextId.current++;
      setTabs((prev) => [...prev, { id, title: 'Loading...', url }]);
      setActiveTab(id);
    };
    window.electronAPI.onOpenNewTab(handler);
    return () => {
      window.electronAPI.onOpenNewTab(() => {});
    };
  }, [isActive]);

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
      {/* Tab bar — same bg as nav bar for seamless look */}
      <div className="flex items-center bg-dark-800 px-1 shrink-0 border-b border-dark-700/50">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`group flex items-center gap-2 max-w-[200px] min-w-[80px] h-[34px] px-3 text-[11px] cursor-pointer select-none transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'border-accent text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="truncate flex-1 font-medium">{tab.title}</span>
            {tabs.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="w-4 h-4 flex items-center justify-center rounded-sm text-gray-600 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
              >
                <svg width="8" height="8" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addTab}
          className="w-7 h-7 flex items-center justify-center rounded-md text-gray-600 hover:text-white hover:bg-white/5 transition-colors ml-0.5 shrink-0"
          title="New tab"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {tabs.map((tab) => (
        <TabWebview
          key={`${accountId}-${tab.id}`}
          accountId={accountId}
          tabId={tab.id}
          initialUrl={tab.url}
          isActive={activeTab === tab.id}
          proxy={proxy}
          onToggleProxy={onToggleProxy}
          proxyHealth={proxyHealth}
          onTitleChange={(title) => updateTabTitle(tab.id, title)}
        />
      ))}
    </div>
  );
}
