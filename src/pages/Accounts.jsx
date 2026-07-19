import { useState, useEffect } from 'react';
import { listAccounts, disconnectAccount } from '../api';
import AccountConnectModal from '../components/AccountConnectModal';

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const load = async () => {
    setError('');
    try {
      const res = await listAccounts();
      setAccounts(Array.isArray(res) ? res : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDisconnect = async (id) => {
    setDisconnecting(id);
    try {
      await disconnectAccount(id);
      setAccounts((prev) => prev.filter((a) => (a.id || a.account_id) !== id));
      setConfirmId(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setDisconnecting(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Accounts</h2>
          <p className="text-sm text-gray-500">Manage connected OnlyFans accounts.</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary">
          + Connect Account
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-gray-500 py-12 text-center">Loading accounts...</div>
      ) : accounts.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400 mb-2">No accounts connected.</p>
          <p className="text-sm text-gray-600">Click "Connect Account" to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => {
            const id = a.id;
            const avatar = a.onlyfans_user_data?.avatar || null;
            const displayName = a.display_name || a.onlyfans_username || id;
            const isActive = a.is_authenticated;
            return (
              <div key={id} className="card flex items-center gap-4">
                {avatar ? (
                  <img src={avatar} alt={displayName} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-dark-500 flex items-center justify-center text-sm font-bold text-gray-400">
                    {displayName[0]}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{displayName}</p>
                  <p className="text-xs text-gray-500">
                    {a.onlyfans_username && `@${a.onlyfans_username}`}
                    {a.onlyfans_email && ` · ${a.onlyfans_email}`}
                  </p>
                </div>

                <span className={`badge ${
                  isActive
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                }`}>
                  {isActive ? 'active' : 'inactive'}
                </span>

                {confirmId === id ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDisconnect(id)}
                      disabled={disconnecting === id}
                      className="btn-danger text-xs py-1.5 px-3"
                    >
                      {disconnecting === id ? '...' : 'Confirm'}
                    </button>
                    <button onClick={() => setConfirmId(null)} className="btn-ghost text-xs py-1.5 px-3">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmId(id)} className="btn-ghost text-xs py-1.5 px-3">
                    Disconnect
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AccountConnectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onConnected={() => {
          setModalOpen(false);
          setLoading(true);
          load();
        }}
      />
    </div>
  );
}
