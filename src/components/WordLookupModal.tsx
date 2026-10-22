import { useState, useEffect } from 'react';
import { lookupWordDefinition, addVocabularyItem, type VocabularyItem } from '../lib/vocabulary';
import { supabase } from '../lib/supabase';

interface WordLookupModalProps {
  word: string | null;
  contextSentence?: string;
  language?: string;
  conversationId?: string;
  userId?: string;
  savedWords: Set<string>;
  onClose: () => void;
  onWordSaved: (item: VocabularyItem) => void;
  onPlayAudio?: (text: string) => void;
}

export default function WordLookupModal({
  word,
  contextSentence,
  language = 'English',
  conversationId,
  userId,
  savedWords,
  onClose,
  onWordSaved,
  onPlayAudio,
}: WordLookupModalProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    word: string;
    translation: string;
    partOfSpeech: string;
    phonetic: string;
    explanation: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cleanWord = word ? word.trim().replace(/[.,!?;:"'()[\]{}«»¡¿]/g, '') : '';
  const isSaved = cleanWord ? savedWords.has(cleanWord.toLowerCase()) : false;

  useEffect(() => {
    if (!word) return;

    const clean = word.trim().replace(/[.,!?;:"'()[\]{}«»¡¿]/g, '');
    let isMounted = true;

    const fetchDefinition = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await lookupWordDefinition(clean, contextSentence, language, session?.access_token);
        if (isMounted) {
          setData(res);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to lookup definition');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchDefinition();

    return () => {
      isMounted = false;
    };
  }, [word, contextSentence, language]);

  if (!word) return null;

  const handleSave = () => {
    if (!data) return;
    const newItem = addVocabularyItem(
      {
        conversationId,
        word: cleanWord,
        translation: data.translation,
        partOfSpeech: data.partOfSpeech,
        phonetic: data.phonetic,
        explanation: data.explanation,
        context: contextSentence,
        language,
      },
      userId
    );
    onWordSaved(newItem);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-sm bg-white dark:bg-[#0d121f] rounded-2xl border border-slate-200/90 dark:border-white/[0.09] p-5 shadow-2xl dark:shadow-black/70 space-y-4 animate-in zoom-in-95 duration-150 transition-colors duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{cleanWord}</span>
              {data?.phonetic && (
                <span className="text-xs font-mono text-slate-400 dark:text-slate-500">{data.phonetic}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50/80 dark:bg-blue-600/15 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-500/30 font-semibold">
                {language}
              </span>
              {data?.partOfSpeech && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400 italic">{data.partOfSpeech}</span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] flex items-center justify-center text-sm font-semibold transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        {loading ? (
          <div className="py-6 text-center space-y-2">
            <div className="w-5 h-5 border-2 border-blue-600/30 border-t-blue-600 rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">Looking up definition...</p>
          </div>
        ) : error ? (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-300 space-y-1">
            <p className="font-semibold">⚠️ Lookup error</p>
            <p>{error}</p>
          </div>
        ) : data ? (
          <div className="space-y-3">
            <div className="p-3.5 bg-slate-50 dark:bg-[#090d16] border border-slate-200/80 dark:border-white/[0.08] rounded-xl space-y-1">
              <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
                Translation
              </div>
              <div className="text-base font-bold text-slate-900 dark:text-white">{data.translation}</div>
              {data.explanation && (
                <p className="text-xs text-slate-600 dark:text-slate-300 pt-1 leading-relaxed">{data.explanation}</p>
              )}
            </div>

            {contextSentence && (
              <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-[#090d16]/60 p-2.5 rounded-lg border border-slate-100 dark:border-white/[0.06] italic">
                &quot;{contextSentence}&quot;
              </div>
            )}
          </div>
        ) : null}

        {/* Actions */}
        <div className="flex items-center justify-between pt-1 gap-2">
          {onPlayAudio && (
            <button
              type="button"
              onClick={() => onPlayAudio(cleanWord)}
              className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200/80 dark:hover:bg-white/[0.1] border border-slate-200/80 dark:border-white/[0.08] text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors flex items-center gap-1.5"
            >
              <span>🔊</span>
              <span>Pronounce</span>
            </button>
          )}

          <div className="flex-1 flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaved || loading || !data}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shadow-xs ${
                isSaved
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-semibold cursor-default'
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/25 active:scale-[0.98]'
              }`}
            >
              <span>{isSaved ? '✓' : '⭐'}</span>
              <span>{isSaved ? 'In Vocab Deck' : 'Save to Vocab'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
