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
      <div className="flex flex-wrap justify-between items-center gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-base font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <span>Vocabulary Deck</span>
            <span className="text-[11px] font-mono bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full border border-blue-200 font-semibold">
              {filteredVocabulary.length} {filteredVocabulary.length === 1 ? 'word' : 'words'}
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Click words in chat to save them. Review with spaced repetition to build long-term memory.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Sub-tab Switcher */}
          <div className="bg-slate-100 p-1 rounded-xl border border-slate-200 flex items-center gap-1 text-xs">
            <button
              onClick={() => setActiveSubTab('flashcards')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeSubTab === 'flashcards'
                  ? 'bg-white text-slate-900 shadow-sm font-semibold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              🃏 Flashcards {dueCards.length > 0 && `(${dueCards.length})`}
            </button>
            <button
              onClick={() => setActiveSubTab('list')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeSubTab === 'list'
                  ? 'bg-white text-slate-900 shadow-sm font-semibold'
                  : 'text-slate-500 hover:text-slate-800'
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
                ? 'bg-blue-50 border-blue-500 text-blue-900 font-semibold'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
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
                  ? 'bg-blue-50 border-blue-500 text-blue-900 font-semibold'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
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
              className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
            />
          </div>
        )}
      </div>

      {/* Mode 1: Flashcards View */}
      {activeSubTab === 'flashcards' ? (
        filteredVocabulary.length === 0 ? (
          <div className="text-center p-12 bg-white rounded-2xl border border-dashed border-slate-300 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center mx-auto text-xl text-blue-600">
              🗂️
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Your vocabulary deck is empty</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
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
          <div className="text-center p-12 bg-white rounded-2xl border border-slate-200 space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto text-xl text-emerald-600">
              🎉
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">All caught up!</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                You've reviewed all cards due for today. Great job keeping your memory fresh!
              </p>
            </div>
            <div className="pt-2">
              <button
                onClick={() => setReviewAllOverride(true)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 transition-colors"
              >
                Review All {filteredVocabulary.length} Cards Anyway
              </button>
            </div>
          </div>
        ) : activeCard ? (
          <div className="space-y-4">
            {/* Progress indicator */}
            <div className="flex justify-between items-center text-xs text-slate-500 font-mono">
              <span>
                Card {currentCardIndex + 1} of {dueCards.length}
              </span>
              <span className="capitalize px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                {activeCard.mastery}
              </span>
            </div>

            {/* Flashcard Box */}
            <div
              onClick={() => setIsFlipped(!isFlipped)}
              className="min-h-[260px] bg-white border border-slate-200 hover:border-blue-300 rounded-2xl p-6 sm:p-8 flex flex-col justify-between cursor-pointer transition-all shadow-sm hover:shadow-md relative select-none"
            >
              <div className="flex justify-between items-start">
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                  {activeCard.language}
                </span>

                {onPlayAudio && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayAudio(activeCard.word);
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    title="Pronounce word"
                  >
                    🔊
                  </button>
                )}
              </div>

              {/* Card Center Content */}
              {!isFlipped ? (
                <div className="text-center py-8 space-y-2">
                  <h3 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                    {activeCard.word}
                  </h3>
                  {activeCard.phonetic && (
                    <p className="text-sm font-mono text-slate-400">{activeCard.phonetic}</p>
                  )}
                  {activeCard.partOfSpeech && (
                    <p className="text-xs text-slate-500 italic">{activeCard.partOfSpeech}</p>
                  )}
                  <p className="text-xs text-blue-600 font-medium pt-3">Tap to flip & reveal answer ↵</p>
                </div>
              ) : (
                <div className="text-center py-6 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="text-xs uppercase font-mono tracking-wider text-slate-400 font-semibold">
                    Translation
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900">{activeCard.translation}</h3>
                  {activeCard.explanation && (
                    <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
                      {activeCard.explanation}
                    </p>
                  )}
                  {activeCard.context && (
                    <div className="text-xs text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100 italic max-w-md mx-auto">
                      "{activeCard.context}"
                    </div>
                  )}
                </div>
              )}

              {/* Flip reminder */}
              <div className="text-center text-[11px] text-slate-400">
                {isFlipped ? 'How well did you remember this?' : 'Flip card to grade yourself'}
              </div>
            </div>

            {/* Spaced Repetition Grading Buttons */}
            {isFlipped && (
              <div className="grid grid-cols-3 gap-2.5 pt-1 animate-in fade-in duration-150">
                <button
                  type="button"
                  onClick={() => handleRateCard('again')}
                  className="p-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100/80 text-rose-800 text-xs font-semibold transition-all shadow-xs flex flex-col items-center justify-center gap-0.5"
                >
                  <span className="font-bold text-sm">Hard</span>
                  <span className="text-[10px] font-mono text-rose-600">Review in 1d</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRateCard('good')}
                  className="p-3 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100/80 text-amber-800 text-xs font-semibold transition-all shadow-xs flex flex-col items-center justify-center gap-0.5"
                >
                  <span className="font-bold text-sm">Good</span>
                  <span className="text-[10px] font-mono text-amber-600">Review in 3d</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRateCard('easy')}
                  className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100/80 text-emerald-800 text-xs font-semibold transition-all shadow-xs flex flex-col items-center justify-center gap-0.5"
                >
                  <span className="font-bold text-sm">Easy</span>
                  <span className="text-[10px] font-mono text-emerald-600">Review in 7d</span>
                </button>
              </div>
            )}
          </div>
        ) : null
      ) : (
        /* Mode 2: Word Bank Table / Card List */
        <div className="space-y-3">
          {filteredVocabulary.length === 0 ? (
            <div className="text-center p-12 bg-white rounded-2xl border border-dashed border-slate-300 text-xs text-slate-500">
              No vocabulary words match your search or filter.
            </div>
          ) : (
            filteredVocabulary.map((item) => (
              <div
                key={item.id}
                className="bg-white border border-slate-200 hover:border-slate-300 p-4 rounded-xl flex items-center justify-between gap-4 transition-all shadow-xs group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-slate-900">{item.word}</span>
                    {item.phonetic && (
                      <span className="text-xs font-mono text-slate-400">{item.phonetic}</span>
                    )}
                    <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                      {item.language}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-semibold border ${
                        item.mastery === 'mastered'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : item.mastery === 'reviewing'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {item.mastery}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-700 mt-1">{item.translation}</div>
                  {item.explanation && (
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">{item.explanation}</p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {onPlayAudio && (
                    <button
                      type="button"
                      onClick={() => onPlayAudio(item.word)}
                      className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors text-xs"
                      title="Pronounce word"
                    >
                      🔊
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => handleDeleteItem(item.id, e)}
                    className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors text-xs"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-slate-900">Add Vocabulary Word</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleManualAdd} className="space-y-3.5">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">Word</label>
                <input
                  type="text"
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  placeholder="e.g. bibliothèque"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Translation <span className="text-slate-400 font-normal">(optional, auto-translated)</span>
                </label>
                <input
                  type="text"
                  value={newTranslation}
                  onChange={(e) => setNewTranslation(e.target.value)}
                  placeholder="Leave empty to auto-translate"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
                />
              </div>

              {addError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                  {addError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingLoading || !newWord.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-all shadow-xs disabled:opacity-50 flex items-center gap-1.5"
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
