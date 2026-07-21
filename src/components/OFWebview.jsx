import { useState, useEffect, useRef } from 'react';
import TabWebview from './TabWebview';

export default function OFWebview({ accountId, proxy, onToggleProxy, isActive }) {
  const [tabs, setTabs] = useState([{ id: 1, title: 'OnlyFans', url: 'https://onlyfans.com' }]);
  const [activeTab, setActiveTab] = useState(1);
  const nextId = useRef(2);

  // Only the active webview instance registers the new-tab handler
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
