import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getProfile,
  getTopPercentage,
  getEarnings,
  listPosts,
  listChats,
  listStories,
  getDateRange,
} from '../api';

function formatMoney(val) {
  if (val == null || isNaN(val)) return '$0.00';
  return '$' + Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNum(n) {
  if (n == null) return '0';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

export default function ModelView() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('posts');
  const [profile, setProfile] = useState(null);
  const [topPct, setTopPct] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [posts, setPosts] = useState([]);
  const [postsCounters, setPostsCounters] = useState(null);
  const [postsHasMore, setPostsHasMore] = useState(false);
  const [postsOffset, setPostsOffset] = useState(0);
  const [chats, setChats] = useState([]);
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setLoading(true);
    const { start, end } = getDateRange('30d');
    Promise.all([
      getProfile(accountId).catch(() => null),
      getTopPercentage(accountId).catch(() => null),
      getEarnings(accountId, start, end).catch(() => null),
      listPosts(accountId, { limit: 10, offset: 0 }).catch(() => null),
      listChats(accountId, { limit: 20 }).catch(() => null),
      listStories(accountId).catch(() => null),
    ]).then(([prof, top, earn, postsData, chatsData, storiesData]) => {
      setProfile(prof);
      setTopPct(top);
      setEarnings(earn);
      if (postsData) {
        setPosts(postsData.list || []);
        setPostsCounters(postsData.counters || null);
        setPostsHasMore(postsData.hasMore || false);
        setPostsOffset(postsData.list?.length || 0);
      }
      setChats(Array.isArray(chatsData) ? chatsData : []);
      setStories(Array.isArray(storiesData) ? storiesData : []);
      setLoading(false);
    });
  }, [accountId]);

  const loadMorePosts = async () => {
    setLoadingMore(true);
    try {
      const data = await listPosts(accountId, { limit: 10, offset: postsOffset });
      if (data?.list) {
        setPosts((prev) => [...prev, ...data.list]);
        setPostsOffset((prev) => prev + data.list.length);
        setPostsHasMore(data.hasMore || false);
      }
    } catch {}
    setLoadingMore(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500">Loading model...</div>
      </div>
    );
  }

  const p = profile || {};

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-gray-400 hover:text-white mb-4 text-sm"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back to Dashboard
      </button>

      {/* Profile Header */}
      <div className="card p-0 overflow-hidden mb-6">
        {/* Banner */}
        <div className="h-48 bg-dark-600 relative">
          {p.header && (
            <img src={p.header} alt="banner" className="w-full h-full object-cover" />
          )}
        </div>

        {/* Avatar + Info */}
        <div className="px-6 pb-5">
          <div className="flex items-end gap-4 -mt-12 mb-4">
            <div className="relative">
              {p.avatar ? (
                <img
                  src={p.avatar}
                  alt={p.name}
                  className="w-24 h-24 rounded-full object-cover border-4 border-dark-700"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-dark-500 border-4 border-dark-700 flex items-center justify-center text-2xl font-bold text-gray-400">
                  {p.name?.[0] || '?'}
                </div>
              )}
              {p.lastSeen && (
                <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-green-500 border-2 border-dark-700" />
              )}
            </div>
            <div className="flex-1 pb-1">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold">{p.name || 'Unknown'}</h2>
                {p.isVerified && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#00AFF0"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                )}
                {topPct?.top_percentage != null && (
                  <span className="badge bg-yellow-500/20 text-yellow-400 ml-1">
                    Top {topPct.top_percentage}%
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500">@{p.username}</p>
            </div>
          </div>

          {/* Stats bar */}
          <div className="flex gap-6 text-sm mb-4">
            <div className="flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span className="text-white font-medium">{formatNum(p.photosCount)}</span>
              <span className="text-gray-500">photos</span>
            </div>
            <div className="flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              <span className="text-white font-medium">{formatNum(p.videosCount)}</span>
              <span className="text-gray-500">videos</span>
            </div>
            <div className="flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span className="text-white font-medium">{formatNum(p.favoritedCount)}</span>
              <span className="text-gray-500">likes</span>
            </div>
            <div className="flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
              <span className="text-white font-medium">{formatNum(p.subscribersCount)}</span>
              <span className="text-gray-500">fans</span>
            </div>
          </div>

          {/* Bio */}
          {p.about && (
            <p className="text-sm text-gray-300 mb-3" dangerouslySetInnerHTML={{ __html: p.about }} />
          )}

          {/* Subscription info */}
          <div className="text-xs text-gray-500">
            {p.subscribePrice > 0 ? `$${p.subscribePrice}/mo` : 'Free subscription'}
            {p.joinDate && ` · Joined ${new Date(p.joinDate).toLocaleDateString()}`}
          </div>
        </div>
      </div>

      {/* Earnings Summary (30 days) */}
      {earnings && (
        <div className="grid grid-cols-5 gap-3 mb-6">
          <div className="card text-center py-3">
            <p className="text-xs text-gray-500 mb-1">Earnings</p>
            <p className="text-lg font-bold text-green-400">{formatMoney(earnings.total_earnings)}</p>
          </div>
          <div className="card text-center py-3">
            <p className="text-xs text-gray-500 mb-1">Subs</p>
            <p className="text-lg font-bold">{formatMoney(earnings.subscriptions)}</p>
          </div>
          <div className="card text-center py-3">
            <p className="text-xs text-gray-500 mb-1">Messages</p>
            <p className="text-lg font-bold">{formatMoney(earnings.messages)}</p>
          </div>
          <div className="card text-center py-3">
            <p className="text-xs text-gray-500 mb-1">Tips</p>
            <p className="text-lg font-bold">{formatMoney(earnings.tips)}</p>
          </div>
          <div className="card text-center py-3">
            <p className="text-xs text-gray-500 mb-1">Posts</p>
            <p className="text-lg font-bold">{formatMoney(earnings.posts)}</p>
          </div>
        </div>
      )}

      {/* Stories */}
      {stories.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">Active Stories</h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {stories.map((s) => (
              <div key={s.id} className="shrink-0 w-20">
                <div className="w-20 h-20 rounded-full border-2 border-accent overflow-hidden">
                  {s.media?.[0]?.files?.preview?.url ? (
                    <img src={s.media[0].files.preview.url} alt="story" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-dark-600" />
                  )}
                </div>
                <p className="text-xs text-gray-500 text-center mt-1 truncate">{timeAgo(s.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-dark-500 mb-4">
        {[
          { key: 'posts', label: `${postsCounters?.postsCount ?? posts.length} Posts` },
          { key: 'chats', label: `Chats (${chats.length})` },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-accent text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'posts' && (
        <div className="space-y-4">
          {posts.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">No posts yet.</div>
          ) : (
            <>
              {posts.map((post) => (
                <PostCard key={post.id} post={post} profile={p} />
              ))}
              {postsHasMore && (
                <button
                  onClick={loadMorePosts}
                  disabled={loadingMore}
                  className="btn-ghost w-full py-3"
                >
                  {loadingMore ? 'Loading...' : 'Load More Posts'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'chats' && (
        <div className="space-y-2">
          {chats.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">No chats.</div>
          ) : (
            chats.map((chat) => <ChatRow key={chat.fan?.id || chat.lastMessage?.id} chat={chat} />)
          )}
        </div>
      )}
    </div>
  );
}

function PostCard({ post, profile }) {
  const media = post.media || [];
  const text = post.rawText || stripHtml(post.text || '');

  return (
    <div className="card">
      {/* Author header */}
      <div className="flex items-center gap-3 mb-3">
        {profile.avatar ? (
          <img src={profile.avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-dark-500" />
        )}
        <div className="flex-1">
          <p className="text-sm font-semibold">{profile.name}</p>
          <p className="text-xs text-gray-500">{timeAgo(post.postedAt)}</p>
        </div>
        {post.isPinned && (
          <span className="badge bg-accent/20 text-accent">Pinned</span>
        )}
      </div>

      {/* Text */}
      {text && <p className="text-sm text-gray-300 mb-3 whitespace-pre-wrap break-words">{text}</p>}

      {/* Media grid */}
      {media.length > 0 && (
        <div className={`grid gap-1 rounded-lg overflow-hidden mb-3 ${
          media.length === 1 ? 'grid-cols-1' : media.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
        }`}>
          {media.slice(0, 6).map((m) => {
            const src = m.files?.preview?.url || m.files?.thumb?.url || m.files?.squarePreview?.url;
            if (!src) return <div key={m.id} className="bg-dark-600 aspect-square" />;
            return (
              <div key={m.id} className="relative aspect-square bg-dark-600">
                <img src={src} alt="" className="w-full h-full object-cover" />
                {m.type === 'video' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-10 h-10 bg-black/50 rounded-full flex items-center justify-center">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {media.length > 6 && (
            <div className="bg-dark-600 aspect-square flex items-center justify-center text-gray-400 text-sm font-medium">
              +{media.length - 6} more
            </div>
          )}
        </div>
      )}

      {/* Engagement */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          {post.favoritesCount || 0}
        </span>
        {post.tipsAmount && post.tipsAmount !== '$0' && (
          <span className="text-green-400">Tips: {post.tipsAmount}</span>
        )}
        {post.mediaCount > 0 && (
          <span>{post.mediaCount} media</span>
        )}
      </div>
    </div>
  );
}

function ChatRow({ chat }) {
  const fan = chat.fan || {};
  const lastMsg = chat.lastMessage || {};
  const avatar = fan.avatar || fan.avatarThumbs?.c50;
  const msgText = stripHtml(lastMsg.text || '');

  return (
    <div className="card flex items-center gap-3 py-3">
      {avatar ? (
        <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
      ) : (
        <div className="w-10 h-10 rounded-full bg-dark-500 flex items-center justify-center text-sm font-bold text-gray-400">
          {(fan.name || '?')[0]}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{fan.name || fan.username || 'Unknown'}</p>
          {fan.subscribedBy && (
            <span className="badge bg-green-500/20 text-green-400">sub</span>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate">{msgText}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-gray-600">{lastMsg.createdAt ? timeAgo(lastMsg.createdAt) : ''}</p>
        {chat.unreadMessagesCount > 0 && (
          <span className="inline-block mt-1 bg-accent text-white text-xs font-bold rounded-full w-5 h-5 leading-5 text-center">
            {chat.unreadMessagesCount}
          </span>
        )}
      </div>
    </div>
  );
}
