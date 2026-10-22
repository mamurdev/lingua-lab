export type VocabularyItem = {
  id: string;
  conversationId?: string;
  word: string;
  translation: string;
  partOfSpeech?: string;
  phonetic?: string;
  explanation?: string;
  context?: string;
  language: string;
  createdAt: string;
  repetitions: number;
  interval: number; // in days
  easeFactor: number;
  nextReviewDate: string; // ISO date string
  lastReviewedDate?: string;
  mastery: 'learning' | 'reviewing' | 'mastered';
};

const STORAGE_KEY = 'lingua_lab_vocabulary';

export function getStoredVocabulary(userId?: string): VocabularyItem[] {
  try {
    const key = userId ? `${STORAGE_KEY}_${userId}` : STORAGE_KEY;
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read vocabulary from localStorage:', err);
    return [];
  }
}

export function saveStoredVocabulary(items: VocabularyItem[], userId?: string): void {
  try {
    const key = userId ? `${STORAGE_KEY}_${userId}` : STORAGE_KEY;
    localStorage.setItem(key, JSON.stringify(items));
  } catch (err) {
    console.error('Failed to save vocabulary to localStorage:', err);
  }
}

export function addVocabularyItem(
  item: Omit<VocabularyItem, 'id' | 'createdAt' | 'repetitions' | 'interval' | 'easeFactor' | 'nextReviewDate' | 'mastery'>,
  userId?: string
): VocabularyItem {
  const existing = getStoredVocabulary(userId);
  const normalized = item.word.toLowerCase().trim();

  // If already exists, return existing
  const found = existing.find(
    (v) => v.word.toLowerCase().trim() === normalized && v.language.toLowerCase() === item.language.toLowerCase()
  );
  if (found) return found;

  const newItem: VocabularyItem = {
    ...item,
    id: `vocab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    repetitions: 0,
    interval: 1,
    easeFactor: 2.5,
    nextReviewDate: new Date().toISOString(),
    mastery: 'learning',
  };

  const updated = [newItem, ...existing];
  saveStoredVocabulary(updated, userId);
  return newItem;
}

export function removeVocabularyItem(id: string, userId?: string): void {
  const existing = getStoredVocabulary(userId);
  const updated = existing.filter((item) => item.id !== id);
  saveStoredVocabulary(updated, userId);
}

// Spaced Repetition Review Rating
export type ReviewRating = 'again' | 'good' | 'easy';

export function reviewVocabularyItem(id: string, rating: ReviewRating, userId?: string): VocabularyItem | null {
  const existing = getStoredVocabulary(userId);
  const index = existing.findIndex((item) => item.id === id);
  if (index === -1) return null;

  const item = existing[index];
  let { repetitions, interval, easeFactor } = item;
  const now = new Date();

  if (rating === 'again') {
    repetitions = 0;
    interval = 1;
    easeFactor = Math.max(1.3, easeFactor - 0.2);
  } else if (rating === 'good') {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 3;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  } else if (rating === 'easy') {
    if (repetitions === 0) {
      interval = 3;
    } else {
      interval = Math.round(interval * easeFactor * 1.3);
    }
    repetitions += 1;
    easeFactor = Math.min(3.0, easeFactor + 0.15);
  }

  // Calculate next review date
  const nextDate = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);

  let mastery: VocabularyItem['mastery'] = 'learning';
  if (repetitions >= 4 || interval >= 14) {
    mastery = 'mastered';
  } else if (repetitions >= 2) {
    mastery = 'reviewing';
  }

  const updatedItem: VocabularyItem = {
    ...item,
    repetitions,
    interval,
    easeFactor,
    lastReviewedDate: now.toISOString(),
    nextReviewDate: nextDate.toISOString(),
    mastery,
  };

  existing[index] = updatedItem;
  saveStoredVocabulary(existing, userId);
  return updatedItem;
}

export async function lookupWordDefinition(
  word: string,
  context?: string,
  language: string = 'English',
  authToken?: string
): Promise<{
  word: string;
  translation: string;
  partOfSpeech: string;
  phonetic: string;
  explanation: string;
  context: string;
  language: string;
}> {
  const response = await fetch('/api/vocabulary/lookup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ word, context, language }),
  });

  if (!response.ok) {
    let errorMsg = `Server error ${response.status}`;
    try {
      const err = await response.json();
      if (err.error) errorMsg = err.error;
    } catch {
      /* ignore json parse failure, retain status error */
    }
    throw new Error(errorMsg);
  }

  return response.json();
}
