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

  const LANGUAGES = [
    { name: 'Spanish', native: 'Español', flag: '🇪🇸' },
    { name: 'French', native: 'Français', flag: '🇫🇷' },
    { name: 'Korean', native: '한국어', flag: '🇰🇷' },
    { name: 'Japanese', native: '日本語', flag: '🇯🇵' },
    { name: 'English', native: 'English', flag: '🇬🇧' },
    { name: 'German', native: 'Deutsch', flag: '🇩🇪' },
  ];

  const LEVELS = [
    { id: 'Beginner', label: 'Beginner', sub: 'CEFR A1 – A2' },
    { id: 'Intermediate', label: 'Intermediate', sub: 'CEFR B1 – B2' },
    { id: 'Advanced', label: 'Advanced', sub: 'CEFR C1 – C2' },
  ];

  const getLanguageFlag = (langName: string) => {
    const found = LANGUAGES.find((l) => l.name.toLowerCase() === langName.toLowerCase());
    return found ? found.flag : '🌐';
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Sticky Clean Header */}
      <header className="bg-white/85 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-sm text-white shadow-sm shadow-blue-500/20">
              LL
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-slate-900">Lingua Lab</h1>
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  Studio
                </span>
              </div>
              <p className="text-xs text-slate-500">AI-guided conversational immersion</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="truncate max-w-[160px] sm:max-w-none">{session.user.email}</span>
            </div>
            <button
              onClick={() => supabase.auth.signOut()}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-all"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        {/* Practice Dialogue Launcher Card */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 shadow-sm space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span>Start Practice Dialogue</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Select your target language and CEFR level to calibrate vocabulary, tone, and tutor syntax.
            </p>
          </div>

          <form onSubmit={startPractice} className="space-y-5">
            {/* Target Language Chips */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">Target Language</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.name}
                    type="button"
                    onClick={() => setLanguage(l.name)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs transition-all ${
                      language === l.name
                        ? 'bg-blue-50 border-blue-500 text-blue-900 shadow-sm ring-1 ring-blue-500/20 font-semibold'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-xl mb-1">{l.flag}</span>
                    <span className="font-semibold text-slate-900">{l.name}</span>
                    <span className="text-[10px] text-slate-400 font-normal">{l.native}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Proficiency Level Cards */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">Proficiency Level</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {LEVELS.map((lvl) => (
                  <button
                    key={lvl.id}
                    type="button"
                    onClick={() => setLevel(lvl.id)}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      level === lvl.id
                        ? 'bg-blue-50 border-blue-500 text-blue-900 shadow-sm ring-1 ring-blue-500/20'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900">{lvl.label}</div>
                    <div className="text-[11px] font-mono text-slate-500 mt-0.5">{lvl.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Start Button */}
            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 shadow-sm shadow-blue-500/20 flex items-center justify-center gap-2"
              >
                {creating ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Preparing Dialogue...</span>
                  </>
                ) : (
                  <>
                    <span>Start Practice Session</span>
                    <span className="text-xs">→</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* Practice Journal Section */}
        <section className="space-y-4">
          <div className="flex justify-between items-center pb-2 border-b border-slate-200">
            <h3 className="text-sm font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <span>Practice Journal</span>
              {conversations.length > 0 && (
                <span className="text-[11px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200 font-semibold">
                  {conversations.length}
                </span>
              )}
            </h3>
          </div>

          {loading ? (
            <div className="text-center text-slate-400 py-16 text-xs font-mono">
              Loading practice journal...
            </div>
          ) : conversations.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto text-slate-400 text-lg">
                💬
              </div>
              <p className="text-sm font-semibold text-slate-800">No practice sessions yet</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Pick a language above to start your first conversational immersion with your personal AI tutor.
              </p>
            </div>
          ) : (
            <div className="grid gap-2.5">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className="bg-white hover:bg-slate-50/80 border border-slate-200/90 hover:border-slate-300 p-4 rounded-xl flex justify-between items-center transition-all shadow-sm group"
                >
                  <Link to={`/chat/${conv.id}`} className="flex-1 min-w-0 mr-4 block">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base">{getLanguageFlag(conv.language)}</span>
                      <h4 className="font-semibold text-sm text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                        {conv.title}
                      </h4>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-600 font-medium">
                        {conv.level}
                      </span>
                    </div>
                    {conv.created_at && (
                      <p className="text-[11px] text-slate-400 mt-1">
                        Recorded on {new Date(conv.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    )}
                  </Link>

                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      to={`/chat/${conv.id}`}
                      className="px-3.5 py-1.5 bg-slate-900 hover:bg-blue-600 text-white rounded-lg text-xs font-semibold transition-all shadow-sm"
                    >
                      Open Chat →
                    </Link>

                    <button
                      onClick={(e) => handleDeleteConversation(e, conv.id, conv.title)}
                      disabled={deletingId === conv.id}
                      title="Delete conversation"
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 rounded-lg text-xs transition-colors disabled:opacity-50"
                    >
                      {deletingId === conv.id ? '⏳' : '🗑️'}
                    </button>
                  </div>
                </div>
              ))}

              {hasMore && (
                <div className="text-center pt-2">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-50 shadow-sm"
                  >
                    {loadingMore ? 'Loading older sessions...' : 'Load older sessions ↓'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
