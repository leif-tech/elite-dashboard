import { useState, useEffect } from 'react';
import { listChats } from '../api';

export default function ChatsView({ apiAccounts }) {
  const [selectedAcct, setSelectedAcct] = useState('');
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const LIMIT = 20;

  useEffect(() => {
    if (!selectedAcct) { setChats([]); return; }
    loadChats(true);
  }, [selectedAcct]);

  const loadChats = async (reset = false) => {
    setLoading(true);
    const newOffset = reset ? 0 : offset;
    try {
      const result = await listChats(selectedAcct, { limit: LIMIT, offset: newOffset });
      const items = Array.isArray(result) ? result : result.list || [];
      if (reset) {
        setChats(items);
        setOffset(items.length);
      } else {
        setChats((prev) => [...prev, ...items]);
        setOffset(newOffset + items.length);
      }
      setHasMore(items.length === LIMIT);
    } catch (err) {
      console.error('Chats fetch error:', err);
    }
    setLoading(false);
  };

  const timeAgo = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) {
      const h = d.getHours();
      const m = d.getMinutes();
      return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
    }
    if (diff < 172800) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const subStatus = (chat) => {
    const user = chat.withUser || chat.user || {};
    if (user.subscribedIsExpiredNow || user.isExpired) return 'expired';
    if (user.subscribedBy) return 'active';
    return null;
  };

  const filtered = chats.filter((chat) => {
    if (filter === 'all') return true;
    const status = subStatus(chat);
    return status === filter;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-dark-600 bg-dark-800">
        <h2 className="text-base font-bold tracking-tight shrink-0">MESSAGES</h2>
        <select
          value={selectedAcct}
          onChange={(e) => setSelectedAcct(e.target.value)}
          className="input !w-auto py-1.5 text-xs min-w-[200px]"
        >
          <option value="">Select account...</option>
          {apiAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.display_name || a.onlyfans_username || a.id}</option>
          ))}
        </select>
      </div>

      {selectedAcct && (
        <>
          {/* Filter tabs */}
          <div className="flex items-center gap-2 px-5 py-2.5 border-b border-dark-600">
            {[
              { key: 'all', label: 'All' },
              { key: 'active', label: 'Active' },
              { key: 'expired', label: 'Expired' },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  filter === f.key
                    ? 'bg-accent text-white'
                    : 'bg-dark-600 text-gray-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
            <span className="ml-auto text-xs text-gray-600">
              {filtered.length} chats
            </span>
          </div>

          {/* Chat list */}
          <div className="flex-1 overflow-y-auto">
            {loading && chats.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">No chats found.</p>
            ) : (
              <>
                {filtered.map((chat) => {
                  const user = chat.withUser || chat.user || {};
                  const avatar = user.avatar || user.avatarThumbs?.c50;
                  const name = user.name || user.username || 'Unknown';
                  const username = user.username;
                  const lastMsg = chat.lastMessage || chat.text || '';
                  const lastTime = chat.lastMessageDate || chat.date || chat.changedAt;
                  const unread = chat.unreadMessagesCount || chat.unread || 0;
                  const status = subStatus(chat);
                  const spent = user.tipsSum || user.totalSpent || null;

                  return (
                    <div
                      key={chat.id || user.id}
                      className="flex items-center gap-3 px-5 py-3 border-b border-dark-700 hover:bg-dark-700/50 transition-colors cursor-pointer"
                    >
                      {/* Avatar */}
                      <div className="relative shrink-0">
                        {avatar ? (
                          <img src={avatar} alt="" className="w-11 h-11 rounded-full object-cover" />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-dark-500 flex items-center justify-center text-sm font-bold text-gray-400">
                            {name[0]?.toUpperCase()}
                          </div>
                        )}
                        {spent && parseFloat(spent) > 0 && (
                          <div className="absolute -bottom-1 -right-1 bg-accent text-white text-[9px] font-bold px-1 py-0.5 rounded-full min-w-[20px] text-center">
                            ${Math.floor(parseFloat(spent))}
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {/* Status badge */}
                          {status && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              status === 'active'
                                ? 'bg-green-600/20 text-green-400'
                                : 'bg-orange-600/20 text-orange-400'
                            }`}>
                              {status === 'active' ? 'Rebill On' : 'Expired'}
                            </span>
                          )}
                          {unread > 0 && (
                            <span className="bg-accent text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                              New
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-sm font-semibold text-white truncate">{name}</span>
                          {username && (
                            <span className="text-xs text-gray-500 truncate">@{username}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{lastMsg || '(no messages)'}</p>
                      </div>

                      {/* Time + indicators */}
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[11px] text-gray-600">{timeAgo(lastTime)}</span>
                        {unread > 0 && (
                          <div className="w-2 h-2 rounded-full bg-accent" />
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Load more */}
                {hasMore && !loading && (
                  <div className="text-center py-4">
                    <button onClick={() => loadChats(false)} className="text-xs text-accent hover:underline">
                      Load more
                    </button>
                  </div>
                )}
                {loading && chats.length > 0 && (
                  <p className="text-xs text-gray-500 py-3 text-center">Loading...</p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {!selectedAcct && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-600">Select an account to view messages.</p>
        </div>
      )}
    </div>
  );
}
