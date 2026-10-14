import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface DashboardProps {
  session: Session;
}

type Conversation = {
  id: string;
  title: string;
  language: string;
  level: string;
  created_at: string;
};

const PAGE_SIZE = 15;

export default function Dashboard({ session }: DashboardProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [language, setLanguage] = useState('Spanish');
  const [level, setLevel] = useState('Beginner');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let ignore = false;
    const fetchInitial = async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .order('created_at', { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (!ignore) {
        if (!error && data) {
          setConversations(data);
          setHasMore(data.length === PAGE_SIZE);
        }
        setLoading(false);
      }
    };

    fetchInitial();
    return () => {
      ignore = true;
    };
  }, []);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    const offset = conversations.length;
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (!error && data) {
      setConversations((prev) => [...prev, ...data]);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  };

  const startPractice = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    const { data, error } = await supabase
      .from('conversations')
      .insert([
        {
          user_id: session.user.id,
          title: `${language} Practice (${level})`,
          language,
          level,
        },
      ])
      .select();

    if (!error && data) {
      setConversations((prev) => [data[0], ...prev]);
    } else {
      console.error("Error creating session:", error);
    }
    setCreating(false);
  };

  // Milestone 5.3: Confirmed deletion with cascade
  const handleDeleteConversation = async (e: React.MouseEvent, convId: string, title: string) => {
    e.preventDefault();
    e.stopPropagation();

    const confirmed = window.confirm(
      `Are you sure you want to delete "${title}"?\n\nThis will permanently delete this conversation and all its messages and quizzes.`
    );
    if (!confirmed) return;

    setDeletingId(convId);
    try {
      const { error } = await supabase.from('conversations').delete().eq('id', convId);
      if (!error) {
        setConversations((prev) => prev.filter((c) => c.id !== convId));
      } else {
        alert("Failed to delete conversation: " + error.message);
      }
    } catch (err) {
      console.error("Delete error:", err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Navigation & User Header */}
        <div className="flex flex-wrap justify-between items-center border-b border-gray-700 pb-4 gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-blue-400">Lingua Lab</h1>
            <p className="text-xs text-gray-400 mt-0.5">Your AI language practice journal</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs sm:text-sm text-gray-400 bg-gray-800 px-3 py-1.5 rounded-full border border-gray-700">
              👤 {session.user.email}
            </span>
            <button
              onClick={() => supabase.auth.signOut()}
              className="px-3.5 py-1.5 bg-gray-800 hover:bg-red-900/60 hover:border-red-700 border border-gray-700 rounded text-xs sm:text-sm font-medium transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Start New Session Form */}
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-xl">
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2 text-gray-100">
            <span>✨</span> Start New Practice Session
          </h2>
          <form onSubmit={startPractice} className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 w-full">
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Target Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full bg-gray-900 p-2.5 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none text-sm"
              >
                <option>Spanish</option>
                <option>French</option>
                <option>Korean</option>
                <option>Japanese</option>
                <option>English</option>
              </select>
            </div>
            <div className="flex-1 w-full">
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Proficiency Level</label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className="w-full bg-gray-900 p-2.5 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none text-sm"
              >
                <option>Beginner (A1-A2)</option>
                <option>Intermediate (B1-B2)</option>
                <option>Advanced (C1)</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={creating}
              className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg font-bold transition-all text-sm disabled:opacity-50 shadow"
            >
              {creating ? "Starting..." : "Start Practice"}
            </button>
          </form>
        </div>

        {/* Saved Sessions List */}
        <div className="space-y-4">
          <div className="flex justify-between items-center border-b border-gray-700 pb-2">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <span>📚</span> Saved Practice Journal
              {conversations.length > 0 && (
                <span className="text-xs bg-gray-800 text-gray-400 px-2.5 py-0.5 rounded-full border border-gray-700 font-normal">
                  {conversations.length} {conversations.length === 1 ? 'session' : 'sessions'}
                </span>
              )}
            </h3>
          </div>

          {loading ? (
            <div className="text-center text-gray-500 py-12">Loading your sessions...</div>
          ) : conversations.length === 0 ? (
            <div className="text-gray-400 bg-gray-800/40 p-10 rounded-xl text-center border border-dashed border-gray-700 space-y-2">
              <div className="text-3xl">💬</div>
              <p className="font-semibold text-gray-300">No practice sessions yet</p>
              <p className="text-xs text-gray-500 max-w-sm mx-auto">
                Pick a language above and click "Start Practice" to begin your first dialogue with the AI tutor!
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className="bg-gray-800 p-4 rounded-xl border border-gray-700 hover:border-gray-600 flex justify-between items-center transition-all group shadow-md"
                >
                  <Link
                    to={`/chat/${conv.id}`}
                    className="flex-1 block mr-4"
                  >
                    <div className="flex items-center gap-2.5">
                      <h4 className="font-bold text-base text-gray-100 group-hover:text-blue-400 transition-colors">
                        {conv.title}
                      </h4>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Language: <span className="text-gray-300 font-medium">{conv.language}</span> • Level: <span className="text-gray-300 font-medium">{conv.level}</span>
                      {conv.created_at && (
                        <span className="text-gray-500 ml-2">
                          ({new Date(conv.created_at).toLocaleDateString()})
                        </span>
                      )}
                    </p>
                  </Link>

                  <div className="flex items-center gap-2">
                    <Link
                      to={`/chat/${conv.id}`}
                      className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600 border border-blue-500/40 rounded-lg text-blue-300 hover:text-white text-xs font-semibold transition-all"
                    >
                      Open Chat →
                    </Link>

                    {/* Milestone 5.3: Confirmed deletion button */}
                    <button
                      onClick={(e) => handleDeleteConversation(e, conv.id, conv.title)}
                      disabled={deletingId === conv.id}
                      title="Delete conversation"
                      className="p-1.5 bg-gray-900/60 hover:bg-red-950/80 hover:text-red-400 text-gray-500 border border-gray-700 rounded-lg text-xs transition-colors disabled:opacity-50"
                    >
                      {deletingId === conv.id ? "⏳" : "🗑️"}
                    </button>
                  </div>
                </div>
              ))}

              {/* Milestone 5.3: Pagination */}
              {hasMore && (
                <div className="text-center pt-2">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-5 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? "Loading more..." : "Load older sessions ↓"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
