import { useState, useEffect, useRef } from 'react';
import {
  sendMassMessage,
  listMassMessageQueue,
  deleteMassMessage,
  listUserLists,
} from '../api';
import VaultMediaPicker from '../components/VaultMediaPicker';

export default function MassMessagesView({ apiAccounts }) {
  const [selectedAcct, setSelectedAcct] = useState('');
  const [message, setMessage] = useState('');
  const [attachedMedia, setAttachedMedia] = useState([]);
  const [showVault, setShowVault] = useState(false);
  const [ppvEnabled, setPpvEnabled] = useState(false);
  const [ppvPrice, setPpvPrice] = useState('');
  const [audience, setAudience] = useState('all');
  const [userLists, setUserLists] = useState([]);
  const [selectedLists, setSelectedLists] = useState([]);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [sending, setSending] = useState(false);
  const [queue, setQueue] = useState([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const abortRef = useRef(null);

  // Load queue when account changes
  useEffect(() => {
    if (!selectedAcct) { setQueue([]); setUserLists([]); setSelectedLists([]); return; }
    setSelectedLists([]);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    loadQueue(ac.signal);
    loadUserLists(ac.signal);
    return () => ac.abort();
  }, [selectedAcct]);

  const loadQueue = async (signal) => {
    setQueueLoading(true);
    try {
      const result = await listMassMessageQueue(selectedAcct, { signal });
      if (signal?.aborted) return;
      setQueue(Array.isArray(result) ? result : result.list || []);
    } catch (err) {
      if (signal?.aborted) return;
      console.error('Queue fetch error:', err);
    }
    if (!signal?.aborted) setQueueLoading(false);
  };

  const loadUserLists = async (signal) => {
    try {
      const result = await listUserLists(selectedAcct, { signal });
      if (signal?.aborted) return;
      setUserLists(Array.isArray(result) ? result : result.list || []);
    } catch {
      if (signal?.aborted) return;
      setUserLists([]);
    }
  };

  const handleSend = async () => {
    if (!selectedAcct || !message.trim()) return;
    setSending(true);
    try {
      const body = {
        text: message,
        media_ids: attachedMedia.map((m) => m.id),
      };
      if (ppvEnabled && ppvPrice) body.price = parseFloat(ppvPrice);
      if (audience === 'active') body.audience = 'active';
      else if (audience === 'expired') body.audience = 'expired';
      else if (audience === 'lists') body.user_list_ids = selectedLists;
      if (scheduleEnabled && scheduleDate) body.scheduled_at = new Date(scheduleDate).toISOString();

      await sendMassMessage(selectedAcct, body);
      // Reset form
      setMessage('');
      setAttachedMedia([]);
      setPpvEnabled(false);
      setPpvPrice('');
      setScheduleEnabled(false);
      setScheduleDate('');
      // Refresh queue
      loadQueue(null);
    } catch (err) {
      alert('Send failed: ' + err.message);
    }
    setSending(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete/unsend this message?')) return;
    try {
      await deleteMassMessage(selectedAcct, id);
      setQueue((q) => q.filter((m) => m.id !== id));
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const statusBadge = (status) => {
    const colors = {
      sent: 'bg-green-600/20 text-green-400',
      sending: 'bg-yellow-600/20 text-yellow-400',
      scheduled: 'bg-blue-600/20 text-blue-400',
      failed: 'bg-red-600/20 text-red-400',
    };
    return colors[status] || 'bg-gray-600/20 text-gray-400';
  };

  return (
    <div className="p-8 overflow-y-auto h-full">
      <h2 className="text-xl font-bold mb-1">Mass Messages</h2>
      <p className="text-sm text-gray-500 mb-6">Compose and send mass messages to fans from any connected model account.</p>

      {/* Account selector */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-1.5">Account</label>
        <select
          value={selectedAcct}
          onChange={(e) => setSelectedAcct(e.target.value)}
          className="input w-full max-w-sm py-2"
        >
          <option value="">Select an API account...</option>
          {apiAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.display_name || a.onlyfans_username || a.id}</option>
          ))}
        </select>
      </div>

      {selectedAcct && (
        <div className="flex gap-6 flex-col lg:flex-row">
          {/* Left: Composer */}
          <div className="flex-1 max-w-lg space-y-4">
            <div className="card space-y-4">
              <h3 className="text-sm font-semibold text-gray-300">Compose</h3>

              {/* Message text */}
              <textarea
                className="input w-full py-2 min-h-[120px] resize-y"
                placeholder="Type your message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />

              {/* Attached media preview */}
              {attachedMedia.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachedMedia.map((m) => (
                    <div key={m.id} className="relative w-14 h-14 rounded-lg overflow-hidden border border-dark-500">
                      <img src={m.thumbnail || m.preview || m.src} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={() => setAttachedMedia((prev) => prev.filter((x) => x.id !== m.id))}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full text-[10px] text-white flex items-center justify-center"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setShowVault(true)}
                className="btn-ghost text-xs border border-dark-500 px-3 py-1.5"
              >
                Attach from Vault
              </button>

              {/* PPV */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ppvEnabled}
                    onChange={(e) => setPpvEnabled(e.target.checked)}
                    className="w-4 h-4 accent-accent"
                  />
                  <span className="text-sm">PPV (Pay-Per-View)</span>
                </label>
                {ppvEnabled && (
                  <input
                    className="input w-24 py-1 text-sm"
                    type="number"
                    min="1"
                    placeholder="$ Price"
                    value={ppvPrice}
                    onChange={(e) => setPpvPrice(e.target.value)}
                  />
                )}
              </div>

              {/* Audience */}
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Audience</label>
                <select
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  className="input w-full py-2"
                >
                  <option value="all">All Fans</option>
                  <option value="active">Active Subscribers Only</option>
                  <option value="expired">Expired Subscribers</option>
                  <option value="lists">Specific User Lists</option>
                </select>
              </div>

              {/* User lists multi-select */}
              {audience === 'lists' && (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {userLists.length === 0 ? (
                    <p className="text-xs text-gray-500">No user lists found.</p>
                  ) : (
                    userLists.map((list) => (
                      <label key={list.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedLists.includes(list.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedLists((p) => [...p, list.id]);
                            else setSelectedLists((p) => p.filter((id) => id !== list.id));
                          }}
                          className="w-3.5 h-3.5 accent-accent"
                        />
                        <span className="text-gray-300">{list.name}</span>
                        {list.users_count != null && (
                          <span className="text-xs text-gray-600">({list.users_count})</span>
                        )}
                      </label>
                    ))
                  )}
                </div>
              )}

              {/* Schedule */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scheduleEnabled}
                    onChange={(e) => setScheduleEnabled(e.target.checked)}
                    className="w-4 h-4 accent-accent"
                  />
                  <span className="text-sm">Schedule for later</span>
                </label>
                {scheduleEnabled && (
                  <input
                    type="datetime-local"
                    className="input w-full py-2 text-sm"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                  />
                )}
              </div>

              {/* Send button */}
              <button
                onClick={handleSend}
                disabled={!message.trim() || sending}
                className="btn-primary w-full py-2.5 text-sm font-medium disabled:opacity-40"
              >
                {sending ? 'Sending...' : scheduleEnabled ? 'Schedule Message' : 'Send Mass Message'}
              </button>
            </div>
          </div>

          {/* Right: Queue */}
          <div className="flex-1 max-w-lg">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300">Message Queue</h3>
                <button onClick={() => loadQueue(null)} className="text-xs text-gray-500 hover:text-accent">Refresh</button>
              </div>

              {queueLoading ? (
                <p className="text-sm text-gray-500 py-4 text-center">Loading...</p>
              ) : queue.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 text-center">No messages sent yet.</p>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {queue.map((msg) => (
                    <div key={msg.id} className="bg-dark-700 rounded-lg p-3 border border-dark-600">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-gray-300 line-clamp-2 flex-1">{msg.text || msg.message || '(media only)'}</p>
                        <span className={`badge shrink-0 ${statusBadge(msg.status)}`}>
                          {msg.status || 'sent'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex gap-3 text-xs text-gray-500">
                          {msg.sent_count != null && <span>Sent: {msg.sent_count}</span>}
                          {msg.viewed_count != null && <span>Viewed: {msg.viewed_count}</span>}
                          {msg.purchased_count != null && <span>Purchased: {msg.purchased_count}</span>}
                          {msg.price && <span className="text-accent">${msg.price}</span>}
                        </div>
                        <button
                          onClick={() => handleDelete(msg.id)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Unsend
                        </button>
                      </div>
                      {msg.scheduled_at && (
                        <p className="text-xs text-gray-600 mt-1">
                          Scheduled: {new Date(msg.scheduled_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Vault picker modal */}
      {showVault && selectedAcct && (
        <VaultMediaPicker
          accountId={selectedAcct}
          onConfirm={(items) => {
            setAttachedMedia((prev) => {
              const ids = new Set(prev.map((m) => m.id));
              return [...prev, ...items.filter((i) => !ids.has(i.id))];
            });
            setShowVault(false);
          }}
          onClose={() => setShowVault(false)}
        />
      )}
    </div>
  );
}
