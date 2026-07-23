import { useState, useEffect, useRef } from 'react';
import { listVaultMedia } from '../api';

export default function VaultMediaPicker({ accountId, onConfirm, onClose }) {
  const [media, setMedia] = useState([]);
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState('all'); // all, photo, video
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const abortRef = useRef(null);
  const LIMIT = 20;

  const fetchMedia = async (reset = false, signal) => {
    setLoading(true);
    try {
      const type = filter === 'all' ? undefined : filter;
      // Use functional state to get current offset (avoids stale closure — VAULT-1)
      const currentOffset = reset ? 0 : offset;
      const result = await listVaultMedia(accountId, { limit: LIMIT, offset: currentOffset, type, signal });
      if (signal?.aborted) return;
      const items = Array.isArray(result) ? result : result.list || [];
      if (reset) {
        setMedia(items);
      } else {
        // Deduplicate on append (VAULT-3)
        setMedia((prev) => {
          const existingIds = new Set(prev.map(m => m.id));
          return [...prev, ...items.filter(m => !existingIds.has(m.id))];
        });
      }
      setHasMore(items.length === LIMIT);
      setOffset(currentOffset + items.length);
    } catch (err) {
      if (signal?.aborted) return;
      console.error('Vault fetch error:', err);
    }
    if (!signal?.aborted) setLoading(false);
  };

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setMedia([]);
    setOffset(0);
    setHasMore(true);
    fetchMedia(true, ac.signal);
    return () => ac.abort();
  }, [accountId, filter]);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const toggleSelect = (item) => {
    setSelected((prev) => {
      const exists = prev.find((s) => s.id === item.id);
      if (exists) return prev.filter((s) => s.id !== item.id);
      return [...prev, item];
    });
  };

  const isSelected = (id) => selected.some((s) => s.id === id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-dark-800 border border-dark-500 rounded-xl w-[700px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-600">
          <h3 className="text-lg font-bold">Vault Media</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl">&times;</button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 px-4 pt-3">
          {['all', 'photo', 'video'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f ? 'bg-accent text-white' : 'bg-dark-600 text-gray-400 hover:text-white'
              }`}
            >
              {f === 'all' ? 'All' : f === 'photo' ? 'Photos' : 'Videos'}
            </button>
          ))}
          {selected.length > 0 && (
            <span className="ml-auto text-xs text-accent self-center">{selected.length} selected</span>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {media.length === 0 && !loading ? (
            <p className="text-center text-gray-500 py-12">No media found in vault.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {media.map((item) => (
                <button
                  key={item.id}
                  onClick={() => toggleSelect(item)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                    isSelected(item.id) ? 'border-accent' : 'border-transparent hover:border-dark-500'
                  }`}
                >
                  <img
                    src={item.thumbnail || item.preview || item.src}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  {item.type === 'video' && (
                    <div className="absolute bottom-1 right-1 bg-black/70 rounded px-1 text-[10px] text-white">
                      VIDEO
                    </div>
                  )}
                  {isSelected(item.id) && (
                    <div className="absolute top-1 right-1 w-5 h-5 bg-accent rounded-full flex items-center justify-center">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Load more */}
          {hasMore && !loading && media.length > 0 && (
            <div className="text-center mt-4">
              <button onClick={() => fetchMedia(false, abortRef.current?.signal)} className="btn-ghost text-xs border border-dark-500 px-4 py-1.5">
                Load More
              </button>
            </div>
          )}
          {loading && <p className="text-center text-gray-500 py-4 text-sm">Loading...</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-dark-600">
          <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
          <button
            onClick={() => onConfirm(selected)}
            disabled={selected.length === 0}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-40"
          >
            Attach {selected.length > 0 ? `(${selected.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
