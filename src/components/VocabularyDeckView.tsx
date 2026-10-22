import { useState, useMemo } from 'react';
import {
  type VocabularyItem,
  type ReviewRating,
  reviewVocabularyItem,
  removeVocabularyItem,
  addVocabularyItem,
  lookupWordDefinition,
} from '../lib/vocabulary';
import { supabase } from '../lib/supabase';

interface VocabularyDeckViewProps {
  vocabulary: VocabularyItem[];
  currentLanguage?: string;
  conversationId?: string;
  userId?: string;
  onVocabularyUpdated: () => void;
  onPlayAudio?: (text: string) => void;
}

export default function VocabularyDeckView({
  vocabulary,
  currentLanguage,
  conversationId,
  userId,
  onVocabularyUpdated,
  onPlayAudio,
}: VocabularyDeckViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'flashcards' | 'list'>('flashcards');
  const [filterLang, setFilterLang] = useState<string>(currentLanguage || 'all');
  const [searchQuery, setSearchQuery] = useState('');

  // Flashcard state
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewAllOverride, setReviewAllOverride] = useState(false);

  // Manual Add Word modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newTranslation, setNewTranslation] = useState('');
  const [addingLoading, setAddingLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Filter items
  const filteredVocabulary = useMemo(() => {
    return vocabulary.filter((item) => {
      const matchesLang =
        filterLang === 'all' || item.language.toLowerCase() === filterLang.toLowerCase();
      const matchesSearch =
        !searchQuery.trim() ||
        item.word.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.translation.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesLang && matchesSearch;
    });
  }, [vocabulary, filterLang, searchQuery]);

  // Flashcards deck (due cards vs all cards)
  const dueCards = useMemo(() => {
    const now = new Date();
    return filteredVocabulary.filter((item) => {
      if (reviewAllOverride) return true;
      if (!item.nextReviewDate) return true;
      return new Date(item.nextReviewDate) <= now;
    });
  }, [filteredVocabulary, reviewAllOverride]);

  const activeCard = dueCards[currentCardIndex] || null;

  const handleRateCard = (rating: ReviewRating) => {
    if (!activeCard) return;
    reviewVocabularyItem(activeCard.id, rating, userId);
    onVocabularyUpdated();
    setIsFlipped(false);
    if (currentCardIndex >= dueCards.length - 1) {
      setCurrentCardIndex(0);
    }
  };

  const handleDeleteItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeVocabularyItem(id, userId);
    onVocabularyUpdated();
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWord.trim()) return;

    setAddingLoading(true);
    setAddError(null);

    try {
      let translation = newTranslation.trim();
      let partOfSpeech = '';
      let phonetic = '';
      let explanation = '';

      // If translation omitted, look up via AI
      if (!translation) {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await lookupWordDefinition(
          newWord.trim(),
          undefined,
          currentLanguage || 'English',
          session?.access_token
        );
        translation = res.translation;
        partOfSpeech = res.partOfSpeech;
        phonetic = res.phonetic;
        explanation = res.explanation;
      }

      addVocabularyItem(
        {
          conversationId,
          word: newWord.trim(),
          translation: translation || 'Saved word',
          partOfSpeech,
          phonetic,
          explanation,
          language: currentLanguage || 'English',
        },
        userId
      );

      onVocabularyUpdated();
      setNewWord('');
      setNewTranslation('');
      setShowAddModal(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add word');
    } finally {
      setAddingLoading(false);
    }
  };

  // Unique languages in user's vocabulary
  const availableLanguages = useMemo(() => {
    const set = new Set(vocabulary.map((v) => v.language));
    if (currentLanguage) set.add(currentLanguage);
    return Array.from(set);
  }, [vocabulary, currentLanguage]);

  return (
    <div className="flex-1 p-4 sm:p-6 overflow-y-auto max-w-3xl w-full mx-auto space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-wrap justify-between items-center gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <span>Vocabulary Deck</span>
            <span className="text-[11px] font-mono bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 px-2.5 py-0.5 rounded-full border border-blue-200 dark:border-blue-800 font-semibold">
              {filteredVocabulary.length} {filteredVocabulary.length === 1 ? 'word' : 'words'}
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Click words in chat to save them. Review with spaced repetition to build long-term memory.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Sub-tab Switcher */}
          <div className="bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-1 text-xs">
            <button
              onClick={() => setActiveSubTab('flashcards')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeSubTab === 'flashcards'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              🃏 Flashcards {dueCards.length > 0 && `(${dueCards.length})`}
            </button>
            <button
              onClick={() => setActiveSubTab('list')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeSubTab === 'list'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              📖 Word Bank
            </button>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1 transition-all"
          >
            <span>+</span>
            <span>Add Word</span>
          </button>
        </div>
      </div>

      {/* Language Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <button
            onClick={() => setFilterLang('all')}
            className={`px-3 py-1 rounded-lg border font-medium transition-all ${
              filterLang === 'all'
                ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-500 dark:border-blue-500 text-blue-900 dark:text-blue-300 font-semibold'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            All Languages
          </button>
          {availableLanguages.map((lang) => (
            <button
              key={lang}
              onClick={() => setFilterLang(lang)}
              className={`px-3 py-1 rounded-lg border font-medium transition-all ${
                filterLang.toLowerCase() === lang.toLowerCase()
                  ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-500 dark:border-blue-500 text-blue-900 dark:text-blue-300 font-semibold'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {lang}
            </button>
          ))}
        </div>

        {activeSubTab === 'list' && (
          <div className="w-full sm:w-64">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search saved words..."
              className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
            />
          </div>
        )}
      </div>

      {/* Mode 1: Flashcards View */}
      {activeSubTab === 'flashcards' ? (
        filteredVocabulary.length === 0 ? (
          <div className="text-center p-12 bg-white dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 flex items-center justify-center mx-auto text-xl text-blue-600 dark:text-blue-400">
              🗂️
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Your vocabulary deck is empty</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              Tap any foreign word in your tutor's messages to look up its definition and save it here.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-all shadow-xs"
            >
              + Add First Word
            </button>
          </div>
        ) : dueCards.length === 0 && !reviewAllOverride ? (
          <div className="text-center p-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center mx-auto text-xl text-emerald-600 dark:text-emerald-400">
              🎉
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">All caught up!</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                You've reviewed all cards due for today. Great job keeping your memory fresh!
              </p>
            </div>
            <div className="pt-2">
              <button
                onClick={() => setReviewAllOverride(true)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
              >
                Review All {filteredVocabulary.length} Cards Anyway
              </button>
            </div>
          </div>
        ) : activeCard ? (
          <div className="space-y-4">
            {/* Progress indicator */}
            <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 font-mono">
              <span>
                Card {currentCardIndex + 1} of {dueCards.length}
              </span>
              <span className="capitalize px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                {activeCard.mastery}
              </span>
            </div>

            {/* Flashcard Box */}
            <div
              onClick={() => setIsFlipped(!isFlipped)}
              className="min-h-[260px] bg-white dark:bg-[#0d121f] border border-slate-200/90 dark:border-white/[0.08] hover:border-blue-300 dark:hover:border-blue-500/50 rounded-2xl p-6 sm:p-8 flex flex-col justify-between cursor-pointer transition-all shadow-sm hover:shadow-md dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] relative select-none"
            >
              <div className="flex justify-between items-start">
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50/80 dark:bg-blue-600/15 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-500/30 font-semibold">
                  {activeCard.language}
                </span>

                {onPlayAudio && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayAudio(activeCard.word);
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
                    title="Pronounce word"
                  >
                    🔊
                  </button>
                )}
              </div>

              {/* Card Center Content */}
              {!isFlipped ? (
                <div className="text-center py-8 space-y-2">
                  <h3 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                    {activeCard.word}
                  </h3>
                  {activeCard.phonetic && (
                    <p className="text-sm font-mono text-slate-400 dark:text-slate-500">{activeCard.phonetic}</p>
                  )}
                  {activeCard.partOfSpeech && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 italic">{activeCard.partOfSpeech}</p>
                  )}
                  <p className="text-xs text-blue-600 dark:text-blue-400 font-medium pt-3">Tap to flip & reveal answer ↵</p>
                </div>
              ) : (
                <div className="text-center py-6 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="text-xs uppercase font-mono tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
                    Translation
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{activeCard.translation}</h3>
                  {activeCard.explanation && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 max-w-md mx-auto leading-relaxed">
                      {activeCard.explanation}
                    </p>
                  )}
                  {activeCard.context && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-white/[0.04] p-2.5 rounded-xl border border-slate-100 dark:border-white/[0.06] italic max-w-md mx-auto">
                      "{activeCard.context}"
                    </div>
                  )}
                </div>
              )}

              {/* Flip reminder */}
              <div className="text-center text-[11px] text-slate-400 dark:text-slate-500">
                {isFlipped ? 'How well did you remember this?' : 'Flip card to grade yourself'}
              </div>
            </div>

            {/* Spaced Repetition Grading Buttons */}
            {isFlipped && (
              <div className="grid grid-cols-3 gap-2.5 pt-1 animate-in fade-in duration-150">
                <button
                  type="button"
                  onClick={() => handleRateCard('again')}
                  className="p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100/80 dark:hover:bg-rose-950/50 text-rose-800 dark:text-rose-300 text-xs font-semibold transition-all shadow-xs flex flex-col items-center justify-center gap-0.5"
                >
                  <span className="font-bold text-sm">Hard</span>
                  <span className="text-[10px] font-mono text-rose-600 dark:text-rose-400">Review in 1d</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRateCard('good')}
                  className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100/80 dark:hover:bg-amber-950/50 text-amber-800 dark:text-amber-300 text-xs font-semibold transition-all shadow-xs flex flex-col items-center justify-center gap-0.5"
                >
                  <span className="font-bold text-sm">Good</span>
                  <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400">Review in 3d</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRateCard('easy')}
                  className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 text-xs font-semibold transition-all shadow-xs flex flex-col items-center justify-center gap-0.5"
                >
                  <span className="font-bold text-sm">Easy</span>
                  <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">Review in 7d</span>
                </button>
              </div>
            )}
          </div>
        ) : null
      ) : (
        /* Mode 2: Word Bank Table / Card List */
        <div className="space-y-3">
          {filteredVocabulary.length === 0 ? (
            <div className="text-center p-12 bg-white dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
              No vocabulary words match your search or filter.
            </div>
          ) : (
            filteredVocabulary.map((item) => (
              <div
                key={item.id}
                className="bg-white dark:bg-[#0f1628] border border-slate-200/90 dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/[0.16] p-4 rounded-xl flex items-center justify-between gap-4 transition-all shadow-xs group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-slate-900 dark:text-white">{item.word}</span>
                    {item.phonetic && (
                      <span className="text-xs font-mono text-slate-400 dark:text-slate-500">{item.phonetic}</span>
                    )}
                    <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50/80 dark:bg-blue-600/15 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-500/30 font-semibold">
                      {item.language}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-semibold border ${
                        item.mastery === 'mastered'
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60'
                          : item.mastery === 'reviewing'
                          ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/60'
                          : 'bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-white/[0.08]'
                      }`}
                    >
                      {item.mastery}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-1">{item.translation}</div>
                  {item.explanation && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{item.explanation}</p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {onPlayAudio && (
                    <button
                      type="button"
                      onClick={() => onPlayAudio(item.word)}
                      className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors text-xs"
                      title="Pronounce word"
                    >
                      🔊
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => handleDeleteItem(item.id, e)}
                    className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors text-xs"
                    title="Remove from vocabulary"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Manual Add Word Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="w-full max-w-sm bg-white dark:bg-[#0d121f] rounded-2xl border border-slate-200/90 dark:border-white/[0.09] p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Add Vocabulary Word</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] flex items-center justify-center text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleManualAdd} className="space-y-3.5">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Word</label>
                <input
                  type="text"
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  placeholder="e.g. bibliothèque"
                  required
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-[#090d16] border border-slate-200 dark:border-white/[0.08] rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-[#12192b] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 dark:focus:ring-blue-500/20"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Translation <span className="text-slate-400 dark:text-slate-500 font-normal">(optional, auto-translated)</span>
                </label>
                <input
                  type="text"
                  value={newTranslation}
                  onChange={(e) => setNewTranslation(e.target.value)}
                  placeholder="Leave empty to auto-translate"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-[#090d16] border border-slate-200 dark:border-white/[0.08] rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-[#12192b] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 dark:focus:ring-blue-500/20"
                />
              </div>

              {addError && (
                <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl text-xs text-rose-700 dark:text-rose-300">
                  {addError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingLoading || !newWord.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition-all shadow-sm shadow-blue-500/25 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {addingLoading ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Adding...</span>
                    </>
                  ) : (
                    'Add Word'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
