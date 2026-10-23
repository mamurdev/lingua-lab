import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import WordLookupModal from '../components/WordLookupModal';
import VocabularyDeckView from '../components/VocabularyDeckView';
import GrammarFeedbackCard, { type GrammarFeedback } from '../components/GrammarFeedbackCard';
import MissionChecklistCard from '../components/MissionChecklistCard';
import ThemeToggle from '../components/ThemeToggle';
import { getStoredVocabulary, type VocabularyItem } from '../lib/vocabulary';
import {
  getStoredScenario,
  saveStoredScenario,
  toggleStoredObjective,
  type Scenario,
} from '../lib/scenarios';

type Message = { id: string; role: 'user' | 'assistant'; content: string; sequence: number; };
type Conversation = { title?: string; language: string; level: string; };

type QuizQuestion = {
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
};

type Exercise = {
  id: string;
  conversation_id: string;
  quiz: {
    questions: QuizQuestion[];
  };
  created_at: string;
};

interface SpeechRecognitionResultItem {
  transcript: string;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultItem;
  };
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface ISpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => ISpeechRecognition;

interface WindowWithSpeech {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

function getSpeechRecognitionClass(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const win = window as unknown as WindowWithSpeech;
  return win.SpeechRecognition || win.webkitSpeechRecognition;
}

export default function ChatPage() {
  const { id } = useParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [convDetails, setConvDetails] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | undefined>(undefined);

  // Tab state: 'chat' | 'quiz' | 'vocab'
  const [activeTab, setActiveTab] = useState<'chat' | 'quiz' | 'vocab'>('chat');

  // Feature 2: Vocabulary Bank state
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [lookupWord, setLookupWord] = useState<string | null>(null);
  const [lookupContext, setLookupContext] = useState<string | undefined>(undefined);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);

  // Feature 1: Grammar and Syntax Feedback state
  const [grammarFeedbackMap, setGrammarFeedbackMap] = useState<Record<string, GrammarFeedback>>(() => {
    if (!id || typeof window === 'undefined') return {};
    try {
      const stored = localStorage.getItem(`lingua_grammar_${id}`);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [analyzingGrammarId, setAnalyzingGrammarId] = useState<string | null>(null);

  // Feature 3: Immersion Scenario & Mission Checklist state
  const [scenario, setScenario] = useState<Scenario | null>(() => {
    return id ? getStoredScenario(id) : null;
  });
  const [missionToast, setMissionToast] = useState<string | null>(null);

  // Audio state (Milestone 3)
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [audioLoadingId, setAudioLoadingId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<Record<string, string>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const audioUrlsRef = useRef<Record<string, string>>({});

  // Voice Speech Recognition state (initialized lazily to avoid cascading setState in effects)
  const [isListening, setIsListening] = useState(false);
  const [speechSupported] = useState<boolean>(() => Boolean(getSpeechRecognitionClass()));
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize input textarea as user types more content
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  // Quiz state (Milestone 4)
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [isGraded, setIsGraded] = useState(false);

  // Milestone 5.3: Session & Architecture Information modal state
  const [showSessionInfo, setShowSessionInfo] = useState(false);

  // Milestone 5.3: In-flight request guards against conversation switching
  const currentConvIdRef = useRef<string | undefined>(id);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const audioAbortControllerRef = useRef<AbortController | null>(null);
  const quizAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    currentConvIdRef.current = id;
  }, [id]);

  useEffect(() => {
    audioUrlsRef.current = audioUrls;
  }, [audioUrls]);

  // Clean up object URLs and speech recognition on unmount
  useEffect(() => {
    return () => {
      Object.values(audioUrlsRef.current).forEach((url) => {
        URL.revokeObjectURL(url);
      });
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  // Initialize user ID and vocabulary
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserId(session.user.id);
        setVocabulary(getStoredVocabulary(session.user.id));
      } else {
        setVocabulary(getStoredVocabulary());
      }
    });
  }, []);

  const refreshVocabulary = () => {
    setVocabulary(getStoredVocabulary(userId));
  };

  const savedWordsSet = useMemo(() => {
    return new Set(vocabulary.map((v) => v.word.toLowerCase().trim()));
  }, [vocabulary]);

  // Pronounce word using browser speech synthesis
  const playWordAudio = (text: string) => {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = getLanguageCode(convDetails?.language);
        window.speechSynthesis.speak(utterance);
      }
    } catch (err) {
      console.warn('Word audio error:', err);
    }
  };

  // Auto-scroll to bottom whenever messages or stream updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, isListening, streamingMessageId]);

  const getLanguageCode = (lang?: string): string => {
    switch (lang?.toLowerCase()) {
      case 'spanish': return 'es-ES';
      case 'french': return 'fr-FR';
      case 'korean': return 'ko-KR';
      case 'japanese': return 'ja-JP';
      case 'english': return 'en-US';
      case 'german': return 'de-DE';
      case 'italian': return 'it-IT';
      case 'portuguese': return 'pt-BR';
      case 'chinese':
      case 'mandarin': return 'zh-CN';
      default: return 'en-US';
    }
  };

  const startListening = () => {
    const SpeechRecognitionClass = getSpeechRecognitionClass();

    if (!SpeechRecognitionClass) {
      setSpeechError('Speech recognition is not supported in this browser. Please try Chrome, Edge, or Safari.');
      return;
    }

    try {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }

      const recognition = new SpeechRecognitionClass();
      recognition.lang = getLanguageCode(convDetails?.language);
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.maxAlternatives = 1;

      const baseText = inputRef.current ? inputRef.current.value : input;

      recognition.onstart = () => {
        setIsListening(true);
        setSpeechError(null);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let currentTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        const prefix = baseText ? baseText.trim() + ' ' : '';
        setInput(prefix + currentTranscript.trimStart());
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.warn('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          setSpeechError('Microphone permission was denied. Please allow microphone access in your browser settings.');
        } else if (event.error !== 'no-speech') {
          setSpeechError(`Voice input error: ${event.error}`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setSpeechError(err instanceof Error ? err.message : 'Could not activate microphone');
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const retryFailedMessage = () => {
    if (!lastFailedMessage) return;
    const msg = lastFailedMessage;
    setLastFailedMessage(null);
    setChatError(null);
    setInput(msg);
  };

  const checkGrammar = async (msg: Message) => {
    if (analyzingGrammarId) return;
    setAnalyzingGrammarId(msg.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch('/api/grammar/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: msg.content,
          language: convDetails?.language || 'English',
          level: convDetails?.level || 'Beginner',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.feedback) {
          setGrammarFeedbackMap((prev) => {
            const updated = { ...prev, [msg.id]: data.feedback };
            try {
              if (id) localStorage.setItem(`lingua_grammar_${id}`, JSON.stringify(updated));
            } catch {
              /* ignore storage write error */
            }
            return updated;
          });
        }
      }
    } catch (err) {
      console.warn('Grammar check error:', err);
    } finally {
      setAnalyzingGrammarId(null);
    }
  };

  const handleToggleObjective = (objectiveId: string) => {
    if (!id) return;
    const updated = toggleStoredObjective(id, objectiveId);
    if (updated) {
      setScenario(updated);
    }
  };

  useEffect(() => {
    // Milestone 5.3: Abort any in-flight requests from the previous conversation
    chatAbortControllerRef.current?.abort();
    audioAbortControllerRef.current?.abort();
    quizAbortControllerRef.current?.abort();

    let active = true;
    const targetId = id;

    const fetchInitialData = async () => {
      if (!targetId) return;

      // 1. Fetch conversation details for the AI prompt context
      const { data: convData } = await supabase.from('conversations').select('*').eq('id', targetId).single();
      if (!active || currentConvIdRef.current !== targetId) return;
      setConvDetails(convData);

      // 2. Fetch the chat history
      const { data: msgData } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', targetId)
        .order('sequence', { ascending: true });
      if (!active || currentConvIdRef.current !== targetId) return;
      setMessages(msgData || []);

      // 3. Fetch existing saved quizzes (Milestone 4)
      const { data: exData } = await supabase
        .from('exercises')
        .select('*')
        .eq('conversation_id', targetId)
        .order('created_at', { ascending: false });
      if (!active || currentConvIdRef.current !== targetId) return;
      setExercises(exData || []);
      setSelectedAnswers({});
      setIsGraded(false);
      setChatError(null);
      setQuizError(null);
      setAudioUrls({});
      setAudioLoadingId(null);
      setPlayingAudioId(null);
      setLoading(false);
      setStreamingMessageId(null);

      // 4. Fetch saved grammar feedback
      try {
        const stored = localStorage.getItem(`lingua_grammar_${targetId}`);
        if (active && currentConvIdRef.current === targetId) {
          setGrammarFeedbackMap(stored ? JSON.parse(stored) : {});
        }
      } catch {
        /* ignore storage read error */
      }

      // 5. Fetch saved immersion scenario
      if (active && currentConvIdRef.current === targetId) {
        const storedScenario = getStoredScenario(targetId);
        setScenario(storedScenario);
      }
    };

    if (targetId) fetchInitialData();

    return () => {
      active = false;
      chatAbortControllerRef.current?.abort();
      audioAbortControllerRef.current?.abort();
      quizAbortControllerRef.current?.abort();
    };
  }, [id]);

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || !id || loading) return;

    if (isListening) {
      stopListening();
    }

    const newMessage = input.trim();
    setInput('');
    setLoading(true);
    setChatError(null);

    const tempUserId = `temp-user-${Date.now()}`;
    const tempAssistantId = `temp-assistant-${Date.now()}`;

    // Optimistic UI — show user message immediately
    const tempUserMsg: Message = {
      id: tempUserId,
      role: 'user',
      content: newMessage,
      sequence: messages.length + 1,
    };

    // Optimistic streaming assistant placeholder
    const tempAssistantMsg: Message = {
      id: tempAssistantId,
      role: 'assistant',
      content: '',
      sequence: messages.length + 2,
    };

    setMessages((prev) => [...prev, tempUserMsg, tempAssistantMsg]);
    setStreamingMessageId(tempAssistantId);

    const activeConvId = id;
    const controller = new AbortController();
    chatAbortControllerRef.current = controller;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (controller.signal.aborted || currentConvIdRef.current !== activeConvId) return;

      const response = await fetch('/api/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: newMessage,
          conversationId: id,
          stream: true,
          scenario: scenario || undefined,
        }),
      });

      if (!response.ok) {
        let errorMsg = `Error ${response.status}`;
        try {
          const errData = await response.json();
          if (errData.error) errorMsg = errData.error;
        } catch {
          /* ignore json parse failure, retain status error */
        }
        throw new Error(errorMsg);
      }

      if (!response.body) {
        throw new Error('Response body stream is unavailable');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let buffer = '';
      let finalAssistantId = tempAssistantId;
      let finalUserId = tempUserId;

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              try {
                const data = JSON.parse(trimmed.slice(6));
                if (data.error) {
                  throw new Error(data.error);
                }
                if (data.chunk) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === tempAssistantId
                        ? { ...m, content: m.content + data.chunk }
                        : m
                    )
                  );
                }
                if (data.done) {
                  if (data.assistantMsgId) finalAssistantId = data.assistantMsgId;
                  if (data.userMsgId) finalUserId = data.userMsgId;
                  if (data.grammarFeedback) {
                    const fb = data.grammarFeedback;
                    setGrammarFeedbackMap((prev) => {
                      const updated = { ...prev, [finalUserId]: fb };
                      try {
                        if (id) localStorage.setItem(`lingua_grammar_${id}`, JSON.stringify(updated));
                      } catch {
                        /* ignore storage write error */
                      }
                      return updated;
                    });
                  }

                  // Feature 3: Live mission objective completion evaluation
                  if (data.scenarioEvaluation) {
                    const evalRes = data.scenarioEvaluation;
                    if (Array.isArray(evalRes.completedIds) && evalRes.completedIds.length > 0) {
                      setScenario((prev) => {
                        if (!prev) return null;
                        const newlyCompletedTexts: string[] = [];
                        const updatedObjs = prev.objectives.map((obj) => {
                          if (evalRes.completedIds.includes(obj.id)) {
                            if (!obj.completed) newlyCompletedTexts.push(obj.text);
                            return { ...obj, completed: true };
                          }
                          return obj;
                        });

                        const updatedScenario = { ...prev, objectives: updatedObjs };
                        if (id) saveStoredScenario(id, updatedScenario);

                        if (newlyCompletedTexts.length > 0) {
                          setMissionToast(`🎯 Objective Complete: "${newlyCompletedTexts[0]}"`);
                          setTimeout(() => setMissionToast(null), 5000);
                        }

                        return updatedScenario;
                      });
                    }
                  }
                }
              } catch (parseErr: unknown) {
                if (parseErr instanceof Error && !parseErr.message.includes('JSON')) {
                  throw parseErr;
                }
              }
            }
          }
        }
      }

      // Reconcile message IDs with database records for voice audio playback
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === tempAssistantId) return { ...m, id: finalAssistantId };
          if (m.id === tempUserId) return { ...m, id: finalUserId };
          return m;
        })
      );

      if (finalAssistantId !== tempAssistantId) {
        setAudioUrls((prev) => {
          if (prev[tempAssistantId]) {
            return { ...prev, [finalAssistantId]: prev[tempAssistantId] };
          }
          return prev;
        });
      }
      setLastFailedMessage(null);
    } catch (error: unknown) {
      if (controller.signal.aborted || currentConvIdRef.current !== activeConvId) {
        return; // Request was aborted or user navigated away; prevent landing state on wrong conversation
      }
      console.error('Failed to send message:', error);
      // Remove optimistic messages on failure, restore draft
      setMessages((prev) => prev.filter((m) => m.id !== tempUserId && m.id !== tempAssistantId));
      setInput(newMessage);
      setLastFailedMessage(newMessage);
      setChatError(error instanceof Error ? error.message : 'Failed to send message');
    } finally {
      if (currentConvIdRef.current === activeConvId) {
        setStreamingMessageId(null);
        setLoading(false);
      }
    }
  };

  const renderInteractiveTutorText = (text: string) => {
    // Split preserving whitespace
    const tokens = text.split(/(\s+)/);
    return tokens.map((token, idx) => {
      if (/^\s+$/.test(token)) {
        return <span key={idx}>{token}</span>;
      }
      const clean = token.replace(/[.,!?;:"'()[\]{}«»¡¿]/g, '').trim();
      if (!clean || clean.length < 2) {
        return <span key={idx}>{token}</span>;
      }

      const isSaved = savedWordsSet.has(clean.toLowerCase());

      return (
        <span
          key={idx}
          onClick={(e) => {
            e.stopPropagation();
            setLookupWord(clean);
            setLookupContext(text);
          }}
          className={`cursor-pointer rounded px-0.5 transition-colors underline decoration-dotted underline-offset-2 ${
            isSaved
              ? 'bg-amber-100/70 dark:bg-amber-500/20 text-amber-900 dark:text-amber-300 decoration-amber-400 dark:decoration-amber-500/60 font-semibold hover:bg-amber-200/70 dark:hover:bg-amber-500/30'
              : 'hover:bg-blue-100 dark:hover:bg-blue-500/20 hover:text-blue-900 dark:hover:text-blue-300 decoration-slate-300 dark:decoration-slate-600 hover:decoration-blue-500'
          }`}
          title="Click to translate & save word"
        >
          {token}
        </span>
      );
    });
  };

  const playAudio = async (msg: Message) => {
    const existingAudio = audioRefs.current[msg.id];
    if (audioUrls[msg.id] && existingAudio) {
      if (existingAudio.paused) {
        Object.entries(audioRefs.current).forEach(([k, el]) => {
          if (el && k !== msg.id) el.pause();
        });
        existingAudio.play().catch(console.error);
        setPlayingAudioId(msg.id);
      } else {
        existingAudio.pause();
        setPlayingAudioId(null);
      }
      return;
    }

    const activeConvId = id;
    const controller = new AbortController();
    audioAbortControllerRef.current = controller;

    setAudioLoadingId(msg.id);
    setAudioError((prev) => ({ ...prev, [msg.id]: '' }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (controller.signal.aborted || currentConvIdRef.current !== activeConvId) return;

      const response = await fetch('/api/speech', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          messageId: msg.id,
          text: msg.content
        }),
      });

      if (!response.ok) {
        let errorMsg = `Server error ${response.status}`;
        try {
          const errData = await response.json();
          if (errData.error) errorMsg = errData.error;
        } catch {
          // ignore
        }
        throw new Error(errorMsg);
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error("Received empty audio response");
      }

      if (controller.signal.aborted || currentConvIdRef.current !== activeConvId) return;

      const audioBlob = new Blob([blob], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(audioBlob);

      Object.values(audioRefs.current).forEach((el) => {
        if (el) el.pause();
      });

      setAudioUrls((prev) => ({ ...prev, [msg.id]: audioUrl }));
      setPlayingAudioId(msg.id);
    } catch (error: unknown) {
      if (controller.signal.aborted || currentConvIdRef.current !== activeConvId) return;
      console.error("Audio playback error:", error);
      const msgText = error instanceof Error ? error.message : "Failed to load audio";
      setAudioError((prev) => ({ ...prev, [msg.id]: msgText }));
    } finally {
      if (currentConvIdRef.current === activeConvId) {
        setAudioLoadingId(null);
      }
    }
  };

  // Milestone 4: Quiz generation handler
  const handleGenerateQuiz = async () => {
    if (!id) return;
    const activeConvId = id;
    const controller = new AbortController();
    quizAbortControllerRef.current = controller;

    setGeneratingQuiz(true);
    setQuizError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (controller.signal.aborted || currentConvIdRef.current !== activeConvId) return;

      const response = await fetch('/api/exercises', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ conversationId: id }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Error ${response.status}: Failed to generate quiz`);
      }

      if (controller.signal.aborted || currentConvIdRef.current !== activeConvId) return;

      if (data.exercise) {
        setExercises((prev) => [data.exercise, ...prev]);
        setSelectedAnswers({});
        setIsGraded(false);
        setActiveTab('quiz');
      }
    } catch (err: unknown) {
      if (controller.signal.aborted || currentConvIdRef.current !== activeConvId) return;
      console.error("Quiz generation error:", err);
      setQuizError(err instanceof Error ? err.message : "Failed to generate review quiz");
    } finally {
      if (currentConvIdRef.current === activeConvId) {
        setGeneratingQuiz(false);
      }
    }
  };

  const currentQuiz = exercises.length > 0 ? exercises[0].quiz : null;

  const handleSelectOption = (questionIdx: number, optionIdx: number) => {
    if (isGraded) return;
    setSelectedAnswers((prev) => ({
      ...prev,
      [questionIdx]: optionIdx,
    }));
  };

  const calculateScore = () => {
    if (!currentQuiz) return 0;
    return currentQuiz.questions.reduce((acc, q, idx) => {
      return acc + (selectedAnswers[idx] === q.answerIndex ? 1 : 0);
    }, 0);
  };

  const allQuestionsAnswered = currentQuiz
    ? currentQuiz.questions.every((_, idx) => selectedAnswers[idx] !== undefined)
    : false;

  const getLanguageFlag = (langName?: string) => {
    switch (langName?.toLowerCase()) {
      case 'spanish': return '🇪🇸';
      case 'french': return '🇫🇷';
      case 'korean': return '🇰🇷';
      case 'japanese': return '🇯🇵';
      case 'english': return '🇬🇧';
      case 'german': return '🇩🇪';
      default: return '🌐';
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc] dark:bg-[#07090e] text-slate-900 dark:text-slate-100 font-sans selection:bg-blue-500/20 selection:text-blue-900 dark:selection:text-blue-200 relative transition-colors duration-200 overflow-hidden">
      {/* Ambient Glow Backdrop */}
      <div className="pointer-events-none absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80">
        <div className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-blue-600/10 to-indigo-600/10 dark:from-blue-500/8 dark:to-indigo-500/8 opacity-60 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]" />
      </div>

      {/* Feature 3: Mission completion toast */}
      {missionToast && (
        <div className="fixed top-14 sm:top-16 right-3 sm:right-6 left-3 sm:left-auto max-w-sm z-50 bg-slate-900/95 dark:bg-[#131b2e] text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl shadow-lg border border-slate-700/80 dark:border-white/[0.1] flex items-center gap-2 animate-bounce">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-xs shadow-emerald-400/50 shrink-0" />
          <span className="truncate">{missionToast}</span>
        </div>
      )}

      {/* Top Header */}
      <header className="px-3 sm:px-6 py-2 sm:py-2.5 bg-white/80 dark:bg-[#07090e]/80 backdrop-blur-xl border-b border-slate-200/80 dark:border-white/[0.08] shrink-0 z-20 transition-colors duration-200">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 max-w-7xl mx-auto">
          {/* Top Row on Mobile, Left Side on Desktop */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Link
                to="/"
                className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200/80 dark:hover:bg-white/[0.1] border border-slate-200/80 dark:border-white/[0.08] text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all flex items-center gap-1 shadow-xs shrink-0"
              >
                <span>←</span>
                <span className="hidden xs:inline">Dashboard</span>
              </Link>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-base sm:text-lg leading-none shrink-0" aria-hidden="true">
                  {getLanguageFlag(convDetails?.language)}
                </span>
                <h1 className="text-xs sm:text-sm font-bold tracking-tight text-slate-900 dark:text-white truncate">
                  {convDetails?.language || 'Language'}
                  <span className="hidden sm:inline"> Dialogue</span>
                </h1>
                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 font-medium shrink-0">
                  {convDetails?.level || 'Beginner'}
                </span>
                <span className="text-slate-300 dark:text-slate-600 select-none text-xs shrink-0 hidden md:inline">•</span>
                <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono shrink-0 hidden md:inline">
                  {messages.length} {messages.length === 1 ? 'msg' : 'msgs'}
                </span>
              </div>
            </div>

            {/* Mobile Actions: Session Info & Theme Toggle */}
            <div className="flex items-center gap-1.5 shrink-0 sm:hidden">
              <button
                type="button"
                onClick={() => setShowSessionInfo(true)}
                title="View Session Memory & Quota Architecture"
                className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-500/25 text-xs font-medium"
                aria-label="View session info"
              >
                <span>ℹ️</span>
              </button>
              <ThemeToggle />
            </div>
          </div>

          {/* Bottom Row on Mobile, Right Side on Desktop */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 w-full sm:w-auto min-w-0">
            <div className="bg-slate-100 dark:bg-white/[0.05] p-0.5 sm:p-1 rounded-xl border border-slate-200/80 dark:border-white/[0.08] flex items-center gap-0.5 sm:gap-1 text-xs flex-1 sm:flex-initial">
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex-1 sm:flex-initial text-center px-2 sm:px-3 py-1.5 rounded-lg transition-all text-xs ${
                  activeTab === 'chat'
                    ? 'bg-white dark:bg-[#162036] text-slate-900 dark:text-white shadow-xs border border-transparent dark:border-white/[0.1] font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                💬 <span className="inline sm:hidden">Chat</span><span className="hidden sm:inline">Dialogue</span>
              </button>
              <button
                onClick={() => setActiveTab('quiz')}
                className={`flex-1 sm:flex-initial text-center px-1.5 sm:px-3 py-1.5 rounded-lg transition-all text-xs truncate ${
                  activeTab === 'quiz'
                    ? 'bg-white dark:bg-[#162036] text-slate-900 dark:text-white shadow-xs border border-transparent dark:border-white/[0.1] font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                📝 <span className="inline sm:hidden">Quiz</span><span className="hidden sm:inline">Review Quiz</span>{exercises.length > 0 && ` (${exercises.length})`}
              </button>
              <button
                onClick={() => setActiveTab('vocab')}
                className={`flex-1 sm:flex-initial text-center px-1.5 sm:px-3 py-1.5 rounded-lg transition-all text-xs truncate ${
                  activeTab === 'vocab'
                    ? 'bg-white dark:bg-[#162036] text-slate-900 dark:text-white shadow-xs border border-transparent dark:border-white/[0.1] font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                🗂️ <span className="inline sm:hidden">Deck</span><span className="hidden sm:inline">Vocab Deck</span>{vocabulary.length > 0 && ` (${vocabulary.length})`}
              </button>
            </div>

            <button
              onClick={handleGenerateQuiz}
              disabled={generatingQuiz || messages.length < 4}
              title={messages.length < 4 ? "Requires at least 2 complete turns (4 messages)" : "Generate review quiz from chat"}
              className="px-2.5 sm:px-3.5 py-1.5 bg-violet-50/90 dark:bg-violet-600/15 hover:bg-violet-100 dark:hover:bg-violet-600/25 text-violet-700 dark:text-violet-300 border border-violet-200/80 dark:border-violet-500/30 disabled:opacity-40 rounded-xl text-xs font-semibold transition-all flex items-center gap-1 shadow-xs shrink-0"
            >
              {generatingQuiz ? (
                <>
                  <span className="w-3 h-3 border-2 border-violet-400/40 border-t-violet-600 rounded-full animate-spin" />
                  <span className="hidden sm:inline">Generating...</span>
                </>
              ) : (
                <>
                  <span>✨</span>
                  <span className="hidden sm:inline">Generate Quiz</span>
                  <span className="inline sm:hidden text-[11px]">Quiz</span>
                </>
              )}
            </button>

            {/* Desktop Session Info & Theme Toggle */}
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowSessionInfo(true)}
                title="View Session Memory & Quota Architecture (Milestone 5.3)"
                className="px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-500/25 text-[11px] font-medium transition-colors inline-flex items-center gap-1 shrink-0 whitespace-nowrap focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-label="View session memory and architecture details"
              >
                <span className="leading-none">ℹ️</span>
                <span className="leading-none">Session Info</span>
              </button>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      {/* Main Area: Chat or Quiz */}
      {activeTab === 'chat' ? (
        <>
          <main className="flex-1 p-3 sm:p-6 overflow-y-auto space-y-3.5 max-w-3xl w-full mx-auto min-w-0">
            {/* Feature 3: Immersion Scenario Checklist */}
            {scenario && (
              <MissionChecklistCard
                scenario={scenario}
                language={convDetails?.language || 'English'}
                onToggleObjective={handleToggleObjective}
              />
            )}

            {messages.length === 0 ? (
              scenario ? (
                <div className="text-center text-slate-500 dark:text-slate-400 mt-6 p-6 bg-white dark:bg-[#0d121f] rounded-2xl border border-slate-200/90 dark:border-white/[0.08] space-y-3 shadow-xs dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
                  <div className="w-12 h-12 rounded-2xl bg-blue-50/80 dark:bg-blue-600/15 border border-blue-200 dark:border-blue-500/30 flex items-center justify-center mx-auto text-2xl shadow-xs">
                    {scenario.icon}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{scenario.title}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                      {scenario.description}
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.08] text-xs font-mono text-slate-700 dark:text-slate-300">
                    <span>You: {scenario.userRole}</span>
                    <span>•</span>
                    <span>AI: {scenario.aiRole}</span>
                  </div>
                  <div className="pt-2">
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-1.5">To kick off the roleplay, try saying:</p>
                    <button
                      type="button"
                      onClick={() => {
                        const hint =
                          scenario.objectives[0]?.hints?.[convDetails?.language || 'Spanish'] ||
                          scenario.objectives[0]?.hints?.English;
                        if (hint) setInput(hint);
                      }}
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-600/15 hover:bg-blue-100/80 dark:hover:bg-blue-600/25 px-3.5 py-1.5 rounded-xl border border-blue-200 dark:border-blue-500/30 transition-colors inline-flex items-center gap-1.5"
                    >
                      <span>💡 &quot;{scenario.objectives[0]?.hints?.[convDetails?.language || 'Spanish'] || '¡Hola!'} &quot;</span>
                      <span className="text-[10px] text-blue-500 dark:text-blue-400">↵ Use prompt</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center text-slate-500 dark:text-slate-400 mt-16 p-8 bg-white dark:bg-[#0d121f] rounded-2xl border border-dashed border-slate-300 dark:border-white/[0.08] space-y-2 shadow-xs">
                  <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.08] flex items-center justify-center mx-auto text-slate-500 dark:text-slate-400 text-lg">
                    {getLanguageFlag(convDetails?.language)}
                  </div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Start your dialogue</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                    Type a greeting or tap 🎙️ to speak to your tutor in {convDetails?.language || 'your target language'}.
                  </p>
                </div>
              )
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'user' ? (
                    <div className="flex flex-col items-end max-w-[90%] sm:max-w-[78%] space-y-1">
                      <div className="p-3.5 sm:p-4.5 rounded-2xl text-sm leading-relaxed shadow-sm bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-br-sm shadow-blue-500/20 break-words">
                        {msg.content}
                      </div>

                      {/* Feature 1: Grammar Feedback */}
                      {grammarFeedbackMap[msg.id] ? (
                        <GrammarFeedbackCard originalText={msg.content} feedback={grammarFeedbackMap[msg.id]} />
                      ) : (
                        msg.id !== streamingMessageId && (
                          <button
                            type="button"
                            onClick={() => checkGrammar(msg)}
                            disabled={analyzingGrammarId === msg.id}
                            className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex items-center gap-1 opacity-70 hover:opacity-100 pr-1"
                          >
                            {analyzingGrammarId === msg.id ? (
                              <>
                                <span className="w-2.5 h-2.5 border border-slate-400 border-t-slate-600 rounded-full animate-spin" />
                                <span>Checking grammar...</span>
                              </>
                            ) : (
                              <span>🔍 Check grammar</span>
                            )}
                          </button>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="max-w-[90%] sm:max-w-[78%] p-3.5 sm:p-5 rounded-2xl text-sm leading-relaxed shadow-sm dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] bg-white dark:bg-[#0d121f] border border-slate-200/90 dark:border-white/[0.08] text-slate-800 dark:text-slate-200 rounded-bl-sm space-y-2.5 transition-colors duration-200 break-words">
                      <div className="flex items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-xs shadow-blue-500/50"></span>
                          <span className="font-semibold text-slate-700 dark:text-slate-300">AI Tutor</span>
                        </div>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 normal-case hidden sm:inline">
                          💡 Click any word to translate & save
                        </span>
                      </div>

                      <div className="whitespace-pre-wrap leading-relaxed">
                        {msg.id !== streamingMessageId
                          ? renderInteractiveTutorText(msg.content)
                          : msg.content}
                        {msg.id === streamingMessageId && msg.content && (
                          <span className="inline-block w-1.5 h-4 ml-1 bg-blue-600 animate-pulse align-middle" />
                        )}
                        {msg.id === streamingMessageId && !msg.content && (
                          <span className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500 py-1 text-xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce"></span>
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:0.2s]"></span>
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:0.4s]"></span>
                            <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">Tutor is thinking...</span>
                          </span>
                        )}
                      </div>

                      {msg.id !== streamingMessageId && (
                        <div className="pt-2 border-t border-slate-100 dark:border-white/[0.06] flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => playAudio(msg)}
                              disabled={audioLoadingId === msg.id}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                playingAudioId === msg.id
                                  ? 'bg-blue-50 dark:bg-blue-600/20 border border-blue-300 dark:border-blue-500/40 text-blue-700 dark:text-blue-300'
                                  : 'bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200/80 dark:hover:bg-white/[0.1] border border-slate-200/80 dark:border-white/[0.08] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              {audioLoadingId === msg.id ? (
                                <>
                                  <span className="w-3 h-3 border-2 border-slate-400/30 border-t-slate-600 rounded-full animate-spin" />
                                  <span>Generating Voice...</span>
                                </>
                              ) : playingAudioId === msg.id ? (
                                <>
                                  <span className="text-blue-600 dark:text-blue-400">⏸</span>
                                  <span>Pause Audio</span>
                                </>
                              ) : (
                                <>
                                  <span className="text-slate-500 dark:text-slate-400">▶</span>
                                  <span>{audioUrls[msg.id] ? "Replay Audio" : "Listen (AI Voice)"}</span>
                                </>
                              )}
                            </button>

                            {/* Hidden audio element for clean native playback */}
                            {audioUrls[msg.id] && (
                              <audio
                                ref={(el) => {
                                  audioRefs.current[msg.id] = el;
                                }}
                                src={audioUrls[msg.id]}
                                autoPlay
                                preload="auto"
                                className="hidden"
                                onPlay={() => {
                                  setPlayingAudioId(msg.id);
                                  Object.entries(audioRefs.current).forEach(([k, other]) => {
                                    if (other && k !== msg.id) other.pause();
                                  });
                                }}
                                onPause={() => {
                                  setPlayingAudioId((curr) => (curr === msg.id ? null : curr));
                                }}
                                onEnded={() => {
                                  setPlayingAudioId((curr) => (curr === msg.id ? null : curr));
                                }}
                              />
                            )}
                          </div>

                          {audioError[msg.id] && (
                            <div className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-900 font-medium">
                              ⚠️ {audioError[msg.id]}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </main>

          <footer className="p-3 sm:p-4 bg-white/80 dark:bg-[#07090e]/80 backdrop-blur-xl border-t border-slate-200/80 dark:border-white/[0.08] transition-colors duration-200">
            <div className="max-w-3xl mx-auto space-y-2">
              {/* Listening Status Banner */}
              {isListening && (
                <div className="flex items-center justify-between px-3.5 py-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-300 shadow-xs">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                    </span>
                    <span className="font-semibold text-rose-800 dark:text-rose-200">
                      Listening in {convDetails?.language || 'target language'}...
                    </span>
                    <span className="text-rose-500 dark:text-rose-400 hidden sm:inline">Speak clearly into microphone</span>
                  </div>
                  <button
                    type="button"
                    onClick={stopListening}
                    className="px-2.5 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-semibold transition-colors"
                  >
                    Done
                  </button>
                </div>
              )}

              {/* Error Banners */}
              {speechError && (
                <div className="flex items-center justify-between px-3.5 py-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl text-xs text-amber-800 dark:text-amber-300">
                  <span>⚠️ {speechError}</span>
                  <button
                    type="button"
                    onClick={() => setSpeechError(null)}
                    className="text-amber-600 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 ml-2 font-bold"
                  >
                    ✕
                  </button>
                </div>
              )}

              {chatError && (
                <div className="flex items-center justify-between px-3.5 py-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-300 shadow-xs">
                  <div className="flex items-center gap-1.5 flex-1 mr-2">
                    <span>⚠️</span>
                    <span className="leading-snug">{chatError}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {lastFailedMessage && (
                      <button
                        type="button"
                        onClick={retryFailedMessage}
                        className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors"
                      >
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setChatError(null)}
                      className="text-rose-600 dark:text-rose-400 hover:text-rose-900 dark:hover:text-rose-200 font-bold px-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Input Dock */}
              <form onSubmit={sendMessage} className="bg-white dark:bg-[#0d121f] border border-slate-200/90 dark:border-white/[0.09] rounded-2xl p-1.5 flex items-end gap-2 shadow-sm dark:shadow-2xl focus-within:border-blue-500 dark:focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-500/20 transition-all">
                {/* Microphone Toggle Button */}
                <button
                  type="button"
                  onClick={toggleListening}
                  disabled={loading || !speechSupported}
                  title={
                    !speechSupported
                      ? "Speech recognition is not supported in this browser (try Chrome, Edge, or Safari)"
                      : isListening
                      ? "Click to stop listening"
                      : `Click to speak in ${convDetails?.language || 'target language'}`
                  }
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                    isListening
                      ? "bg-rose-600 hover:bg-rose-700 text-white ring-2 ring-rose-400/50 shadow-md animate-pulse"
                      : "bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.1] text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-white/[0.08] disabled:opacity-40"
                  }`}
                >
                  {isListening ? (
                    <span className="w-2.5 h-2.5 rounded-sm bg-white" />
                  ) : (
                    <span className="text-base" role="img" aria-label="Microphone">🎙️</span>
                  )}
                </button>

                <div className="relative flex-1 min-w-0">
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        if ((e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) return;
                        e.preventDefault();
                        if (!loading && input.trim()) {
                          sendMessage();
                        }
                      }
                    }}
                    placeholder={
                      isListening
                        ? `Listening in ${convDetails?.language || 'target language'}... speak now`
                        : "Type or click 🎙️ to speak..."
                    }
                    disabled={loading}
                    className="w-full bg-transparent px-2.5 py-2 text-sm sm:text-base text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none resize-none overflow-y-auto max-h-[180px] leading-relaxed block"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="h-10 px-4 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:opacity-40 rounded-xl text-xs sm:text-sm font-semibold text-white transition-all shadow-sm shadow-blue-500/25 flex items-center gap-1.5 shrink-0"
                >
                  {loading ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span className="hidden sm:inline">Sending...</span>
                    </>
                  ) : (
                    <>
                      <span>Send</span>
                      <span className="text-xs">↵</span>
                    </>
                  )}
                </button>
              </form>
              <p className="text-[10px] text-center text-slate-400 dark:text-slate-500 font-medium mt-2">
                Tutor retains latest 20 messages · Audio temporarily cached in session · Shared AI quota (00:00 UTC reset)
              </p>
            </div>
          </footer>
        </>
      ) : activeTab === 'quiz' ? (
        /* Milestone 4: Interactive Quiz View */
        <main className="flex-1 p-3 sm:p-6 overflow-y-auto max-w-3xl w-full mx-auto space-y-5 min-w-0">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 pb-4 border-b border-slate-200/80 dark:border-white/[0.08]">
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">Review Quiz</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Practice vocabulary and grammar derived from your recent dialogue turns. Generated questions persist in your conversation; chosen answers and scores are evaluated locally in this browser session.
              </p>
            </div>
            {messages.length < 4 && (
              <span className="text-[11px] font-mono text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-800 font-medium self-start sm:self-auto shrink-0">
                ⚠️ Need at least 4 messages (2 turns)
              </span>
            )}
          </div>

          {quizError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-rose-700 dark:text-rose-300 text-xs font-medium">
              ⚠️ {quizError}
            </div>
          )}

          {!currentQuiz ? (
            <div className="text-center p-12 bg-white dark:bg-[#0d121f] rounded-2xl border border-dashed border-slate-300 dark:border-white/[0.08] space-y-4 shadow-xs">
              <div className="w-12 h-12 rounded-2xl bg-violet-50/80 dark:bg-violet-600/15 border border-violet-200/80 dark:border-violet-500/30 flex items-center justify-center mx-auto text-xl text-violet-600 dark:text-violet-400 shadow-xs">
                📝
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">No review quiz generated yet</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Once you've had a few practice turns, generate a tailored quiz to consolidate what you learned.
                </p>
              </div>
              <button
                onClick={handleGenerateQuiz}
                disabled={generatingQuiz || messages.length < 4}
                className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-xl text-xs font-semibold text-white transition-all shadow-sm shadow-violet-500/25 inline-flex items-center gap-2"
              >
                {generatingQuiz ? "⏳ Generating Quiz..." : "✨ Generate 3-Question Quiz"}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Score header if graded */}
              {isGraded && (
                <div className="p-5 bg-white dark:bg-[#0d121f] border border-violet-200 dark:border-violet-500/30 rounded-2xl flex justify-between items-center shadow-sm dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Quiz Completed</h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Score: <span className="font-bold text-violet-700 dark:text-violet-400">{calculateScore()} / {currentQuiz.questions.length}</span> ({Math.round((calculateScore() / currentQuiz.questions.length) * 100)}%)
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedAnswers({});
                      setIsGraded(false);
                    }}
                    className="px-3.5 py-1.5 bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.1] rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-white/[0.08] transition-colors"
                  >
                    🔄 Try Again
                  </button>
                </div>
              )}

              {/* Questions */}
              <div className="space-y-4">
                {currentQuiz.questions.map((q, qIdx) => {
                  const userChoice = selectedAnswers[qIdx];
                  const isCorrect = userChoice === q.answerIndex;

                  return (
                    <div
                      key={qIdx}
                      className="p-5 sm:p-6 bg-white dark:bg-[#0d121f] rounded-2xl border border-slate-200/90 dark:border-white/[0.08] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] space-y-4 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-lg bg-violet-50/90 dark:bg-violet-600/15 border border-violet-200/80 dark:border-violet-500/30 text-violet-700 dark:text-violet-400 flex items-center justify-center text-xs font-mono font-bold">
                          {qIdx + 1}
                        </span>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">{q.prompt}</h4>
                      </div>

                      {/* 4 Radio Options */}
                      <div className="space-y-2 pl-0 sm:pl-9">
                        {q.options.map((option, optIdx) => {
                          const isSelected = userChoice === optIdx;
                          const isTheCorrectAnswer = optIdx === q.answerIndex;

                          let optionStyles = 'border-slate-200/90 dark:border-white/[0.08] bg-slate-50/70 dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/[0.16] hover:bg-slate-100/70 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200';

                          if (isGraded) {
                            if (isTheCorrectAnswer) {
                              optionStyles = 'border-emerald-500 dark:border-emerald-500/80 bg-emerald-50/90 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-300 font-medium';
                            } else if (isSelected && !isTheCorrectAnswer) {
                              optionStyles = 'border-rose-400 dark:border-rose-500/80 bg-rose-50/90 dark:bg-rose-950/40 text-rose-900 dark:text-rose-300 font-medium';
                            } else {
                              optionStyles = 'border-slate-200/80 dark:border-white/[0.05] bg-slate-50/40 dark:bg-white/[0.02] text-slate-400 dark:text-slate-600';
                            }
                          } else if (isSelected) {
                            optionStyles = 'border-blue-500 dark:border-blue-400 bg-blue-50/80 dark:bg-blue-600/15 text-blue-900 dark:text-blue-300 ring-1 ring-blue-500/20 font-medium';
                          }

                          return (
                            <label
                              key={optIdx}
                              onClick={() => handleSelectOption(qIdx, optIdx)}
                              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all text-xs sm:text-sm ${optionStyles}`}
                            >
                              <input
                                type="radio"
                                name={`question-${qIdx}`}
                                checked={isSelected}
                                onChange={() => handleSelectOption(qIdx, optIdx)}
                                disabled={isGraded}
                                className="accent-blue-600 w-4 h-4 cursor-pointer"
                              />
                              <span className="flex-1">{option}</span>
                              {isGraded && isTheCorrectAnswer && (
                                <span className="text-emerald-700 dark:text-emerald-400 text-xs font-semibold">✓ Correct</span>
                              )}
                              {isGraded && isSelected && !isTheCorrectAnswer && (
                                <span className="text-rose-600 dark:text-rose-400 text-xs font-semibold">✗ Incorrect</span>
                              )}
                            </label>
                          );
                        })}
                      </div>

                      {/* Explanation box after grading */}
                      {isGraded && (
                        <div className="mt-3 p-3.5 bg-slate-50 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/[0.08] rounded-xl text-xs text-slate-600 dark:text-slate-300 ml-0 sm:ml-9 leading-relaxed">
                          <p className="font-semibold text-violet-700 dark:text-violet-400 mb-1">
                            {isCorrect ? '💡 Excellent!' : '💡 Explanation:'}
                          </p>
                          <p>{q.explanation}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Check Answers Action */}
              {!isGraded ? (
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => setIsGraded(true)}
                    disabled={!allQuestionsAnswered}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:opacity-40 rounded-xl font-semibold text-xs text-white transition-all shadow-sm shadow-blue-500/25"
                  >
                    Check Answers
                  </button>
                </div>
              ) : (
                <div className="flex justify-between items-center pt-2">
                  <button
                    onClick={handleGenerateQuiz}
                    disabled={generatingQuiz}
                    className="text-xs text-violet-700 dark:text-violet-400 hover:text-violet-900 dark:hover:text-violet-300 underline font-semibold"
                  >
                    Generate another quiz
                  </button>
                  <button
                    onClick={() => {
                      setSelectedAnswers({});
                      setIsGraded(false);
                    }}
                    className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-xl font-semibold text-xs text-white transition-all shadow-sm shadow-violet-500/25"
                  >
                    🔄 Try Again
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      ) : (
        /* Feature 2: Vocabulary Deck & Spaced Repetition View */
        <VocabularyDeckView
          vocabulary={vocabulary}
          currentLanguage={convDetails?.language}
          conversationId={id}
          userId={userId}
          onVocabularyUpdated={refreshVocabulary}
          onPlayAudio={playWordAudio}
        />
      )}

      {/* 1-Click Word Lookup Popover Modal */}
      {lookupWord && (
        <WordLookupModal
          word={lookupWord}
          contextSentence={lookupContext}
          language={convDetails?.language}
          conversationId={id}
          userId={userId}
          savedWords={savedWordsSet}
          onClose={() => {
            setLookupWord(null);
            setLookupContext(undefined);
          }}
          onWordSaved={() => {
            refreshVocabulary();
          }}
          onPlayAudio={playWordAudio}
        />
      )}

      {/* Milestone 5.3: Session Architecture & Policy Modal */}
      {showSessionInfo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-info-title"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setShowSessionInfo(false)}
        >
          <div
            className="bg-white dark:bg-[#0d121f] rounded-2xl border border-slate-200 dark:border-white/[0.08] p-6 max-w-md w-full shadow-2xl space-y-4 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 dark:border-white/[0.08]">
              <h3 id="session-info-title" className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>ℹ️</span> Session Memory & Architecture
              </h3>
              <button
                type="button"
                onClick={() => setShowSessionInfo(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-label="Close session details"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
              <div className="p-3 bg-slate-50 dark:bg-white/[0.03] rounded-xl border border-slate-200/80 dark:border-white/[0.06] space-y-1">
                <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span>🧠</span> 20-Message Context Window
                </p>
                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  The AI tutor retains the latest 20 messages of your dialogue transcript to ensure prompt relevance, concise corrections, and focused conversational coherence.
                </p>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-white/[0.03] rounded-xl border border-slate-200/80 dark:border-white/[0.06] space-y-1">
                <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span>🔊</span> Temporary Audio Caching
                </p>
                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Voice pronunciation is generated on-demand and cached temporarily in memory for this browser session. Refreshing or reopening will generate fresh audio on click.
                </p>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-white/[0.03] rounded-xl border border-slate-200/80 dark:border-white/[0.06] space-y-1">
                <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span>📝</span> Local Quiz Grading
                </p>
                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Review quiz questions are saved permanently to your session history. Chosen options and grading scores remain local to this browser session and reset on reload.
                </p>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-white/[0.03] rounded-xl border border-slate-200/80 dark:border-white/[0.06] space-y-1">
                <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span>🛡️</span> Quotas & Turn Limits
                </p>
                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Daily allowance: 60 shared AI turns/day and 30 voice turns/day, resetting at 00:00 UTC with a 6 requests/minute rate limit. Sessions cap at 100 complete turns.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowSessionInfo(false)}
              className="w-full py-2 bg-slate-900 dark:bg-white/[0.08] hover:bg-slate-800 dark:hover:bg-white/[0.12] text-white text-xs font-semibold rounded-xl transition-all focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}