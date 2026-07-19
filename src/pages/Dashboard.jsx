import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import StatCard from '../components/StatCard';
import {
  listAccounts,
  getProfile,
  getTopPercentage,
  getEarnings,
  getDateRange,
} from '../api';

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: 'all', label: 'All Time' },
];

const REFRESH_MS = 5 * 60 * 1000;

function formatMoney(val) {
  if (val == null || isNaN(val)) return '$0.00';
  return '$' + Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNum(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString();
}

export default function Dashboard() {
  const [range, setRange] = useState('30d');
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const intervalRef = useRef(null);

  const loadData = async () => {
    setError('');
    try {
      // listAccounts returns the array directly (unwrapped by api.js)
      const acctList = await listAccounts();

      if (!acctList?.length) {
        setModels([]);
        setLoading(false);
        setLastRefresh(new Date());
        return;
      }

      const { start, end } = getDateRange(range);

      // Fetch all model data in parallel
      const enriched = await Promise.all(
        acctList.map(async (a) => {
          const id = a.id;
          const userData = a.onlyfans_user_data || {};

          // Profile, top %, and earnings in parallel
          const [profile, topPct, earnings] = await Promise.all([
            getProfile(id).catch(() => null),
            getTopPercentage(id).catch(() => null),
            getEarnings(id, start, end).catch(() => null),
          ]);

          // Name/username/avatar: prefer profile data, fall back to account data
          const name = profile?.name || userData.name || a.display_name || a.onlyfans_username || 'Unknown';
          const username = profile?.username || a.onlyfans_username || '';
          const avatar = profile?.avatar || userData.avatar || null;
          const fans = profile?.subscribersCount ?? userData.subscribersCount ?? 0;
          const topPercent = topPct?.top_percentage ?? profile?.performerTop ?? null;

          return {
            id,
            name,
            username,
            avatar,
            status: a.is_authenticated ? 'active' : 'inactive',
            topPercent,
            totalEarnings: earnings?.total_earnings ?? 0,
            subscriptions: earnings?.subscriptions ?? 0,
            tips: earnings?.tips ?? 0,
            messages: earnings?.messages ?? 0,
            posts: earnings?.posts ?? 0,
            fans,
          };
        })
      );

      setModels(enriched);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [range]);

  useEffect(() => {
    intervalRef.current = setInterval(loadData, REFRESH_MS);
    return () => clearInterval(intervalRef.current);
  }, [range]);

  // Totals
  const totalEarnings = models.reduce((s, m) => s + (m.totalEarnings || 0), 0);
  const totalFans = models.reduce((s, m) => s + (m.fans || 0), 0);
  const totalSubs = models.reduce((s, m) => s + (m.subscriptions || 0), 0);
  const totalTips = models.reduce((s, m) => s + (m.tips || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Dashboard</h2>
          <p className="text-sm text-gray-500">
            {models.length} model{models.length !== 1 ? 's' : ''} connected
            {lastRefresh && (
              <span className="ml-2">
                &middot; Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-1 bg-dark-700 rounded-lg p-1">
          {RANGES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                range === key
                  ? 'bg-accent text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Summary row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Earnings" value={formatMoney(totalEarnings)} color="text-green-400" />
        <StatCard label="Total Fans" value={formatNum(totalFans)} color="text-accent" />
        <StatCard label="Subscriptions" value={formatMoney(totalSubs)} />
        <StatCard label="Tips" value={formatMoney(totalTips)} />
      </div>

      {/* Model cards */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-500">Loading models...</div>
        </div>
      ) : models.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400 mb-2">No models connected yet.</p>
          <p className="text-sm text-gray-600">Go to Accounts to connect OnlyFans accounts.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {models.map((m) => (
            <ModelCard key={m.id} model={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModelCard({ model: m }) {
  const navigate = useNavigate();
  return (
    <div
      className="card hover:border-accent/40 transition-colors cursor-pointer"
      onClick={() => navigate(`/model/${m.id}`)}
    >
      <div className="flex items-center gap-3 mb-4">
        {m.avatar ? (
          <img
            src={m.avatar}
            alt={m.name}
            className="w-11 h-11 rounded-full object-cover border-2 border-dark-500"
          />
        ) : (
          <div className="w-11 h-11 rounded-full bg-dark-500 flex items-center justify-center text-lg font-bold text-gray-400">
            {m.name?.[0] || '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{m.name}</p>
          <p className="text-xs text-gray-500">@{m.username}</p>
        </div>
        {m.topPercent != null && (
          <span className="badge bg-yellow-500/20 text-yellow-400">
            Top {m.topPercent}%
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-500">Earnings</p>
          <p className="text-lg font-bold text-green-400">{formatMoney(m.totalEarnings)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Fans</p>
          <p className="text-lg font-bold text-accent">{formatNum(m.fans)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Subs Revenue</p>
          <p className="text-sm font-semibold">{formatMoney(m.subscriptions)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Tips</p>
          <p className="text-sm font-semibold">{formatMoney(m.tips)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Messages</p>
          <p className="text-sm font-semibold">{formatMoney(m.messages)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Posts</p>
          <p className="text-sm font-semibold">{formatMoney(m.posts)}</p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-dark-500 flex items-center justify-between">
        <span className={`badge ${
          m.status === 'active'
            ? 'bg-green-500/20 text-green-400'
            : 'bg-red-500/20 text-red-400'
        }`}>
          {m.status}
        </span>
      </div>
    </div>
  );
}
