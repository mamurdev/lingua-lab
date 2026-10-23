import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import ThemeToggle from '../components/ThemeToggle';
import {
  CURATED_SCENARIOS,
  getStoredScenario,
  saveStoredScenario,
  type Scenario,
} from '../lib/scenarios';

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
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [practiceMode, setPracticeMode] = useState<'freeform' | 'missions'>('freeform');
  const [language, setLanguage] = useState('Spanish');
  const [level, setLevel] = useState('Beginner');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [missionCreatingId, setMissionCreatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [usage, setUsage] = useState<{
    ai: { used: number; limit: number; remaining: number };
    voice: { used: number; limit: number; remaining: number };
  } | null>(null);

  useEffect(() => {
    let ignore = false;
    const fetchUsage = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch('/api/usage', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok && !ignore) {
          const data = await res.json();
          setUsage(data);
        }
      } catch {
        // ignore background usage fetch error
      }
    };
    fetchUsage();
    return () => {
      ignore = true;
    };
  }, []);

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

    try {
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

      if (!error && data && data[0]) {
        navigate(`/chat/${data[0].id}`);
      } else {
        console.error("Error creating session:", error);
      }
    } finally {
      setCreating(false);
    }
  };

  // Feature 3: Launch structured immersion mission
  const startMission = async (scenario: Scenario) => {
    setMissionCreatingId(scenario.id);
    try {
      const title = `${scenario.icon} ${scenario.title} (${language})`.slice(0, 80);
      const { data, error } = await supabase
        .from('conversations')
        .insert([
          {
            user_id: session.user.id,
            title,
            language,
            level: scenario.difficulty,
          },
        ])
        .select();

      if (!error && data && data[0]) {
        saveStoredScenario(data[0].id, scenario);
        navigate(`/chat/${data[0].id}`);
      } else {
        console.error("Error creating mission session:", error);
      }
    } catch (err) {
      console.error("Failed to start mission:", err);
    } finally {
      setMissionCreatingId(null);
    }
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
    <div className="min-h-screen bg-[#f8fafc] dark:bg-[#07090e] text-slate-900 dark:text-slate-100 font-sans selection:bg-blue-500/20 selection:text-blue-900 dark:selection:text-blue-200 transition-colors duration-200 relative overflow-hidden">
      {/* Ambient Glow Backdrop */}
      <div className="pointer-events-none absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80">
        <div className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-blue-600/15 to-indigo-600/10 dark:from-blue-500/10 dark:to-indigo-500/10 opacity-70 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]" />
      </div>

      {/* Sticky Clean Header */}
      <header className="bg-white/80 dark:bg-[#07090e]/80 backdrop-blur-xl border-b border-slate-200/80 dark:border-white/[0.08] sticky top-0 z-20 transition-colors duration-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center font-bold text-sm text-white shadow-sm shadow-blue-500/30">
              LL
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">Lingua Lab</h1>
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-white/[0.06] px-2 py-0.5 rounded border border-slate-200/80 dark:border-white/[0.08]">
                  Studio
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">AI-guided conversational immersion</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />

            <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.08] text-xs text-slate-600 dark:text-slate-300 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/50 shrink-0"></span>
              <span className="truncate max-w-[120px] xs:max-w-[160px] sm:max-w-none">{session.user.email}</span>
            </div>
            <button
              onClick={() => supabase.auth.signOut()}
              className="px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] border border-transparent hover:border-slate-200 dark:hover:border-white/[0.08] transition-all shrink-0"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-3.5 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-8 min-w-0">
        {/* Practice Dialogue & Missions Launcher Card */}
        <section className="bg-white dark:bg-[#0d121f] border border-slate-200/90 dark:border-white/[0.08] rounded-2xl p-4 sm:p-7 shadow-sm dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] space-y-5 sm:space-y-6 transition-colors duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-100 dark:border-white/[0.06]">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                <span>{practiceMode === 'freeform' ? '💬 Freeform Conversation' : '🎯 Immersion Scenarios & Missions'}</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {practiceMode === 'freeform'
                  ? 'Open dialogue with your AI tutor calibrated to your CEFR proficiency level.'
                  : 'Real-world roleplay missions with structured objectives and live persona feedback.'}
              </p>
            </div>

            {/* Switcher: Freeform on Left, Missions on Right */}
            <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.08] text-xs shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setPracticeMode('freeform')}
                className={`px-3 py-1.5 rounded-lg transition-all font-semibold ${
                  practiceMode === 'freeform'
                    ? 'bg-white dark:bg-[#162036] text-slate-900 dark:text-white shadow-xs border border-transparent dark:border-white/[0.1]'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                💬 Freeform
              </button>
              <button
                type="button"
                onClick={() => setPracticeMode('missions')}
                className={`px-3 py-1.5 rounded-lg transition-all font-semibold ${
                  practiceMode === 'missions'
                    ? 'bg-white dark:bg-[#162036] text-slate-900 dark:text-white shadow-xs border border-transparent dark:border-white/[0.1]'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                🎯 Missions
              </button>
            </div>
          </div>

          <div className="space-y-5">
            {/* Target Language Chips */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Target Language</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.name}
                    type="button"
                    onClick={() => setLanguage(l.name)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs transition-all ${
                      language === l.name
                        ? 'bg-blue-50/80 dark:bg-blue-600/15 border-blue-500 dark:border-blue-400 text-blue-900 dark:text-blue-300 shadow-sm ring-1 ring-blue-500/20 font-semibold'
                        : 'bg-white dark:bg-[#0f1628] border-slate-200/90 dark:border-white/[0.07] text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/[0.16] hover:bg-slate-50 dark:hover:bg-[#141d33]'
                    }`}
                  >
                    <span className="text-xl mb-1">{l.flag}</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{l.name}</span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">{l.native}</span>
                  </button>
                ))}
              </div>
            </div>

            {practiceMode === 'missions' ? (
              /* Feature 3: Immersion Scenario Cards */
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <span>Available Immersion Missions</span>
                  <span className="text-[11px] font-normal text-slate-400 dark:text-slate-500">
                    Select a mission to begin guided real-world roleplay
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {CURATED_SCENARIOS.map((scenario) => {
                    const isStartingThis = missionCreatingId === scenario.id;

                    return (
                      <div
                        key={scenario.id}
                        className="p-4 rounded-xl border border-slate-200/90 dark:border-white/[0.08] hover:border-blue-400/80 dark:hover:border-blue-500/50 bg-white dark:bg-[#0f1628] hover:bg-slate-50/50 dark:hover:bg-[#131b31] transition-all shadow-xs hover:shadow-md dark:hover:shadow-blue-950/20 flex flex-col justify-between space-y-3 group"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <span className="text-2xl p-1.5 rounded-xl bg-slate-100/90 dark:bg-white/[0.06] border border-slate-200/60 dark:border-white/[0.08]">
                                {scenario.icon}
                              </span>
                              <div>
                                <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                  {scenario.title}
                                </h4>
                                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
                                  {scenario.category} · {scenario.difficulty}
                                </span>
                              </div>
                            </div>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 font-semibold shrink-0">
                              {scenario.objectives.length} Goals
                            </span>
                          </div>

                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {scenario.description}
                          </p>

                          <div className="flex items-center gap-1.5 flex-wrap text-[11px] pt-1">
                            <span className="px-2 py-0.5 rounded-md bg-blue-50/90 dark:bg-blue-600/15 border border-blue-200/80 dark:border-blue-500/30 text-blue-800 dark:text-blue-300 font-medium">
                              Partner: {scenario.aiRole}
                            </span>
                          </div>
                        </div>

                        {/* Objectives preview */}
                        <div className="pt-2 border-t border-slate-100 dark:border-white/[0.06] flex items-center justify-between gap-3">
                          <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                            🎯 1st goal: {scenario.objectives[0]?.text}
                          </div>

                          <button
                            type="button"
                            onClick={() => startMission(scenario)}
                            disabled={Boolean(missionCreatingId) || creating}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white rounded-lg text-xs font-semibold transition-all disabled:opacity-50 shrink-0 shadow-xs shadow-blue-600/25 flex items-center gap-1.5"
                          >
                            {isStartingThis ? (
                              <>
                                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span>Launching...</span>
                              </>
                            ) : (
                              <>
                                <span>Start Mission</span>
                                <span>→</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Freeform Practice Launcher */
              <form onSubmit={startPractice} className="space-y-5 pt-1">
                {/* Proficiency Level Cards */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Proficiency Level</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {LEVELS.map((lvl) => (
                      <button
                        key={lvl.id}
                        type="button"
                        onClick={() => setLevel(lvl.id)}
                        className={`p-3.5 rounded-xl border text-left transition-all ${
                          level === lvl.id
                            ? 'bg-blue-50/80 dark:bg-blue-600/15 border-blue-500 dark:border-blue-400 text-blue-900 dark:text-blue-300 shadow-sm ring-1 ring-blue-500/20'
                            : 'bg-white dark:bg-[#0f1628] border-slate-200/90 dark:border-white/[0.07] text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/[0.16] hover:bg-slate-50 dark:hover:bg-[#141d33]'
                        }`}
                      >
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{lvl.label}</div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">{lvl.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Start Button */}
                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={creating}
                    className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 shadow-sm shadow-blue-500/25 flex items-center justify-center gap-2"
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
            )}

            {/* Milestone 5.1: Quota & Reset Policy Product Copy */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-white/[0.06] text-[11px] text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/50" />
                <span>
                  {usage ? `${usage.ai.remaining}/${usage.ai.limit} AI practice turns left today` : '60 daily AI practice turns'}
                </span>
                {usage && (
                  <span className="text-[10px] opacity-75 font-mono">
                    ({usage.voice.remaining}/{usage.voice.limit} voice)
                  </span>
                )}
              </span>
              <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                Resets daily at 00:00 UTC · 6 requests/min rate limit
              </span>
            </div>
          </div>
        </section>

        {/* Practice Journal Section - shown ONLY when in freeform mode */}
        {practiceMode === 'freeform' && (
          <section className="space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200/80 dark:border-white/[0.08]">
              <h3 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <span>Practice Journal</span>
                {conversations.length > 0 && (
                  <span className="text-[11px] font-mono bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full border border-slate-200/80 dark:border-white/[0.08] font-semibold">
                    {conversations.length}
                  </span>
                )}
              </h3>
            </div>

            {loading ? (
              <div className="text-center text-slate-400 dark:text-slate-500 py-16 text-xs font-mono">
                Loading practice journal...
              </div>
            ) : conversations.length === 0 ? (
              <div className="bg-white dark:bg-[#0d121f] border border-dashed border-slate-300 dark:border-white/[0.08] rounded-2xl p-12 text-center space-y-3">
                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.08] flex items-center justify-center mx-auto text-slate-400 text-lg">
                  💬
                </div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">No practice sessions yet</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                  Pick a language above to start your first conversational immersion with your personal AI tutor.
                </p>
              </div>
            ) : (
              <div className="grid gap-2.5">
              {conversations.map((conv) => {
                const storedScenario = getStoredScenario(conv.id);
                const completedGoals = storedScenario
                  ? storedScenario.objectives.filter((o) => o.completed).length
                  : 0;
                const totalGoals = storedScenario ? storedScenario.objectives.length : 0;
                const isAllDone = totalGoals > 0 && completedGoals === totalGoals;

                return (
                  <div
                    key={conv.id}
                    className="bg-white dark:bg-[#0f1628] hover:bg-slate-50/80 dark:hover:bg-[#131b31] border border-slate-200/90 dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/[0.16] p-3.5 sm:p-4 rounded-xl flex justify-between items-center transition-all shadow-xs group min-w-0"
                  >
                    <Link to={`/chat/${conv.id}`} className="flex-1 min-w-0 mr-2.5 sm:mr-4 block">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <span className="text-base shrink-0">{getLanguageFlag(conv.language)}</span>
                        <h4 className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                          {conv.title}
                        </h4>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 font-medium shrink-0">
                          {conv.level}
                        </span>

                        {storedScenario && (
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-semibold border shrink-0 ${
                              isAllDone
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60'
                                : 'bg-blue-50/90 dark:bg-blue-600/15 text-blue-700 dark:text-blue-300 border-blue-200/80 dark:border-blue-500/30'
                            }`}
                          >
                            {storedScenario.icon} {isAllDone ? '✓ Completed' : `${completedGoals}/${totalGoals} Goals`}
                          </span>
                        )}
                      </div>
                      {conv.created_at && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                          Recorded on {new Date(conv.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                      )}
                    </Link>

                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                      <Link
                        to={`/chat/${conv.id}`}
                        className="px-2.5 sm:px-3.5 py-1.5 bg-slate-900 dark:bg-blue-600 hover:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-all shadow-xs"
                      >
                        <span className="inline sm:hidden">Chat →</span>
                        <span className="hidden sm:inline">Open Chat →</span>
                      </Link>

                      <button
                        onClick={(e) => handleDeleteConversation(e, conv.id, conv.title)}
                        disabled={deletingId === conv.id}
                        title="Delete conversation"
                        className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-transparent hover:border-rose-200 dark:hover:border-rose-900/60 rounded-lg text-xs transition-colors disabled:opacity-50"
                      >
                        {deletingId === conv.id ? '⏳' : '🗑️'}
                      </button>
                    </div>
                  </div>
                );
              })}

              {hasMore && (
                <div className="text-center pt-2">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-4 py-2 bg-white dark:bg-[#0f1628] hover:bg-slate-100 dark:hover:bg-[#141d33] border border-slate-200/80 dark:border-white/[0.08] rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors disabled:opacity-50 shadow-xs"
                  >
                    {loadingMore ? 'Loading older sessions...' : 'Load older sessions ↓'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  </div>
);
}
