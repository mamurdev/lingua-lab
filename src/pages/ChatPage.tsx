import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import WordLookupModal from '../components/WordLookupModal';
import VocabularyDeckView from '../components/VocabularyDeckView';
import { getStoredVocabulary, type VocabularyItem } from '../lib/vocabulary';

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
  const inputRef = useRef<HTMLInputElement>(null);

  // Quiz state (Milestone 4)
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [isGraded, setIsGraded] = useState(false);

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

  useEffect(() => {
    const fetchInitialData = async () => {
      // 1. Fetch conversation details for the AI prompt context
      const { data: convData } = await supabase.from('conversations').select('*').eq('id', id).single();
      if (convData) setConvDetails(convData);

      // 2. Fetch the chat history
      const { data: msgData } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', id)
        .order('sequence', { ascending: true });
      if (msgData) setMessages(msgData);

      // 3. Fetch existing saved quizzes (Milestone 4)
      const { data: exData } = await supabase
        .from('exercises')
        .select('*')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false });
      if (exData) setExercises(exData);
    };

    if (id) fetchInitialData();
  }, [id]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
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

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: newMessage,
          language: convDetails?.language || 'English',
          level: convDetails?.level || 'Beginner',
          conversationHistory: messages,
          conversationId: id,
          stream: true,
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
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic messages on failure, restore draft
      setMessages((prev) => prev.filter((m) => m.id !== tempUserId && m.id !== tempAssistantId));
      setInput(newMessage);
      setLastFailedMessage(newMessage);
      setChatError(error instanceof Error ? error.message : 'Failed to send message');
    } finally {
      setStreamingMessageId(null);
      setLoading(false);
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
              ? 'bg-amber-100/70 text-amber-900 decoration-amber-400 font-semibold hover:bg-amber-200/70'
              : 'hover:bg-blue-100 hover:text-blue-900 decoration-slate-300 hover:decoration-blue-500'
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

    setAudioLoadingId(msg.id);
    setAudioError((prev) => ({ ...prev, [msg.id]: '' }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch('/api/speech', {
        method: 'POST',
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

      const audioBlob = new Blob([blob], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(audioBlob);

      Object.values(audioRefs.current).forEach((el) => {
        if (el) el.pause();
      });

      setAudioUrls((prev) => ({ ...prev, [msg.id]: audioUrl }));
      setAudioLoadingId(null);
      setPlayingAudioId(msg.id);
    } catch (error) {
      console.error("Audio playback error:", error);
      const msgText = error instanceof Error ? error.message : "Failed to load audio";
      setAudioError((prev) => ({ ...prev, [msg.id]: msgText }));
      setAudioLoadingId(null);
    }
  };

  // Milestone 4: Quiz generation handler
  const handleGenerateQuiz = async () => {
    if (!id) return;
    setGeneratingQuiz(true);
    setQuizError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch('/api/exercises', {
        method: 'POST',
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

      if (data.exercise) {
        setExercises((prev) => [data.exercise, ...prev]);
        setSelectedAnswers({});
        setIsGraded(false);
        setActiveTab('quiz');
      }
    } catch (err) {
      console.error("Quiz generation error:", err);
      setQuizError(err instanceof Error ? err.message : "Failed to generate review quiz");
    } finally {
      setGeneratingQuiz(false);
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
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Top Header */}
      <header className="px-4 sm:px-6 py-3 bg-white/85 backdrop-blur-md border-b border-slate-200/80 flex flex-wrap justify-between items-center gap-3 shrink-0 z-20">
        <div className="flex items-center gap-3 sm:gap-4">
          <Link
            to="/"
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-xs font-semibold text-slate-700 hover:text-slate-900 transition-all flex items-center gap-1.5 shadow-xs"
          >
            <span>←</span>
            <span>Dashboard</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-xl">{getLanguageFlag(convDetails?.language)}</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-slate-900">
                  {convDetails?.language || 'Language'} Dialogue
                </h1>
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-600 font-medium">
                  {convDetails?.level || 'Beginner'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                {messages.length} {messages.length === 1 ? 'message' : 'messages'}
              </p>
            </div>
          </div>
        </div>

        {/* View Switcher & Quiz Action */}
        <div className="flex items-center gap-2.5">
          <div className="bg-slate-100 p-1 rounded-xl border border-slate-200 flex items-center gap-1 text-xs">
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeTab === 'chat'
                  ? 'bg-white text-slate-900 shadow-sm font-semibold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              💬 Dialogue
            </button>
            <button
              onClick={() => setActiveTab('quiz')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeTab === 'quiz'
                  ? 'bg-white text-slate-900 shadow-sm font-semibold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              📝 Review Quiz {exercises.length > 0 && `(${exercises.length})`}
            </button>
            <button
              onClick={() => setActiveTab('vocab')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeTab === 'vocab'
                  ? 'bg-white text-slate-900 shadow-sm font-semibold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              🗂️ Vocab Deck {vocabulary.length > 0 && `(${vocabulary.length})`}
            </button>
          </div>

          <button
            onClick={handleGenerateQuiz}
            disabled={generatingQuiz || messages.length < 4}
            title={messages.length < 4 ? "Requires at least 2 complete turns (4 messages)" : "Generate review quiz from chat"}
            className="px-3.5 py-1.5 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 disabled:opacity-40 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shadow-xs"
          >
            {generatingQuiz ? (
              <>
                <span className="w-3 h-3 border-2 border-violet-400/40 border-t-violet-600 rounded-full animate-spin" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <span>✨ Generate Quiz</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Area: Chat or Quiz */}
      {activeTab === 'chat' ? (
        <>
          <main className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4 max-w-3xl w-full mx-auto">
            {messages.length === 0 ? (
              <div className="text-center text-slate-500 mt-16 p-8 bg-white rounded-2xl border border-dashed border-slate-300 space-y-2 shadow-xs">
                <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto text-slate-500 text-lg">
                  {getLanguageFlag(convDetails?.language)}
                </div>
                <p className="text-sm font-semibold text-slate-800">Start your dialogue</p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Type a greeting or tap 🎙️ to speak to your tutor in {convDetails?.language || 'your target language'}.
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] sm:max-w-[78%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-sm shadow-blue-500/10'
                        : 'bg-white border border-slate-200/90 text-slate-800 rounded-bl-sm space-y-2.5'
                    }`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="flex items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                          <span className="font-semibold text-slate-600">AI Tutor</span>
                        </div>
                        <span className="text-[10px] text-slate-400 normal-case hidden sm:inline">
                          💡 Click any word to translate & save
                        </span>
                      </div>
                    )}

                    <div className="whitespace-pre-wrap leading-relaxed">
                      {msg.role === 'assistant' && msg.id !== streamingMessageId
                        ? renderInteractiveTutorText(msg.content)
                        : msg.content}
                      {msg.id === streamingMessageId && msg.content && (
                        <span className="inline-block w-1.5 h-4 ml-1 bg-blue-600 animate-pulse align-middle" />
                      )}
                      {msg.id === streamingMessageId && !msg.content && (
                        <span className="flex items-center gap-1.5 text-slate-400 py-1 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce"></span>
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:0.2s]"></span>
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:0.4s]"></span>
                          <span className="text-xs text-slate-400 ml-1">Tutor is thinking...</span>
                        </span>
                      )}
                    </div>

                    {msg.role === 'assistant' && msg.id !== streamingMessageId && (
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => playAudio(msg)}
                            disabled={audioLoadingId === msg.id}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                              playingAudioId === msg.id
                                ? 'bg-blue-50 border border-blue-300 text-blue-700'
                                : 'bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-700 hover:text-slate-900'
                            }`}
                          >
                            {audioLoadingId === msg.id ? (
                              <>
                                <span className="w-3 h-3 border-2 border-slate-400/30 border-t-slate-600 rounded-full animate-spin" />
                                <span>Generating Voice...</span>
                              </>
                            ) : playingAudioId === msg.id ? (
                              <>
                                <span className="text-blue-600">⏸</span>
                                <span>Pause Audio</span>
                              </>
                            ) : (
                              <>
                                <span className="text-slate-500">▶</span>
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
                          <div className="text-[11px] text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200 font-medium">
                            ⚠️ {audioError[msg.id]}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </main>

          <footer className="p-3 sm:p-4 bg-white/85 backdrop-blur-md border-t border-slate-200/80">
            <div className="max-w-3xl mx-auto space-y-2">
              {/* Listening Status Banner */}
              {isListening && (
                <div className="flex items-center justify-between px-3.5 py-2 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 shadow-xs">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                    </span>
                    <span className="font-semibold text-rose-800">
                      Listening in {convDetails?.language || 'target language'}...
                    </span>
                    <span className="text-rose-500 hidden sm:inline">Speak clearly into microphone</span>
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
                <div className="flex items-center justify-between px-3.5 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                  <span>⚠️ {speechError}</span>
                  <button
                    type="button"
                    onClick={() => setSpeechError(null)}
                    className="text-amber-600 hover:text-amber-900 ml-2 font-bold"
                  >
                    ✕
                  </button>
                </div>
              )}

              {chatError && (
                <div className="flex items-center justify-between px-3.5 py-2 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 shadow-xs">
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
                      className="text-rose-600 hover:text-rose-900 font-bold px-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Input Dock */}
              <form onSubmit={sendMessage} className="bg-white border border-slate-200 rounded-2xl p-1.5 flex items-center gap-2 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
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
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 disabled:opacity-40"
                  }`}
                >
                  {isListening ? (
                    <span className="w-2.5 h-2.5 rounded-sm bg-white" />
                  ) : (
                    <span className="text-base" role="img" aria-label="Microphone">🎙️</span>
                  )}
                </button>

                <div className="relative flex-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={
                      isListening
                        ? `Listening in ${convDetails?.language || 'target language'}... speak now`
                        : "Type or click 🎙️ to speak..."
                    }
                    disabled={loading}
                    className="w-full bg-transparent px-2.5 py-2 text-sm sm:text-base text-slate-900 placeholder:text-slate-400 focus:outline-none"
                  />
                  {input.length > 0 && !loading && (
                    <button
                      type="button"
                      onClick={() => setInput('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs px-1"
                      title="Clear draft"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="px-4 sm:px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-xl text-xs sm:text-sm font-semibold transition-all disabled:opacity-40 shrink-0 shadow-sm shadow-blue-500/20 flex items-center gap-1.5"
                >
                  {loading ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span className="hidden sm:inline">Sending</span>
                    </>
                  ) : (
                    <>
                      <span>Send</span>
                      <span className="text-[10px] opacity-70 hidden sm:inline">↵</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </footer>
        </>
      ) : activeTab === 'quiz' ? (
        /* Milestone 4: Interactive Quiz View */
        <main className="flex-1 p-4 sm:p-6 overflow-y-auto max-w-3xl w-full mx-auto space-y-6">
          <div className="flex justify-between items-center pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900">Review Quiz</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Practice vocabulary and grammar derived from your recent dialogue turns.
              </p>
            </div>
            {messages.length < 4 && (
              <span className="text-[11px] font-mono text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 font-medium">
                ⚠️ Need at least 4 messages (2 turns)
              </span>
            )}
          </div>

          {quizError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-medium">
              ⚠️ {quizError}
            </div>
          )}

          {!currentQuiz ? (
            <div className="text-center p-12 bg-white rounded-2xl border border-dashed border-slate-300 space-y-4 shadow-xs">
              <div className="w-12 h-12 rounded-2xl bg-violet-50 border border-violet-200 flex items-center justify-center mx-auto text-xl text-violet-600 shadow-xs">
                📝
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900">No review quiz generated yet</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Once you've had a few practice turns, generate a tailored quiz to consolidate what you learned.
                </p>
              </div>
              <button
                onClick={handleGenerateQuiz}
                disabled={generatingQuiz || messages.length < 4}
                className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-xl text-xs font-semibold text-white transition-all shadow-sm shadow-violet-500/20 inline-flex items-center gap-2"
              >
                {generatingQuiz ? "⏳ Generating Quiz..." : "✨ Generate 3-Question Quiz"}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Score header if graded */}
              {isGraded && (
                <div className="p-5 bg-white border border-violet-200 rounded-2xl flex justify-between items-center shadow-sm">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Quiz Completed</h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Score: <span className="font-bold text-violet-700">{calculateScore()} / {currentQuiz.questions.length}</span> ({Math.round((calculateScore() / currentQuiz.questions.length) * 100)}%)
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedAnswers({});
                      setIsGraded(false);
                    }}
                    className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-semibold text-slate-700 border border-slate-200 transition-colors"
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
                      className="p-5 sm:p-6 bg-white rounded-2xl border border-slate-200 space-y-4 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-lg bg-violet-50 border border-violet-200 text-violet-700 flex items-center justify-center text-xs font-mono font-bold">
                          {qIdx + 1}
                        </span>
                        <h4 className="text-sm font-bold text-slate-900 leading-snug">{q.prompt}</h4>
                      </div>

                      {/* 4 Radio Options */}
                      <div className="space-y-2 pl-9">
                        {q.options.map((option, optIdx) => {
                          const isSelected = userChoice === optIdx;
                          const isTheCorrectAnswer = optIdx === q.answerIndex;

                          let optionStyles = 'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-100/70 text-slate-700';

                          if (isGraded) {
                            if (isTheCorrectAnswer) {
                              optionStyles = 'border-emerald-500 bg-emerald-50 text-emerald-900 font-medium';
                            } else if (isSelected && !isTheCorrectAnswer) {
                              optionStyles = 'border-rose-400 bg-rose-50 text-rose-900 font-medium';
                            } else {
                              optionStyles = 'border-slate-200 bg-slate-50/40 text-slate-400';
                            }
                          } else if (isSelected) {
                            optionStyles = 'border-blue-500 bg-blue-50 text-blue-900 ring-1 ring-blue-500/20 font-medium';
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
                                <span className="text-emerald-700 text-xs font-semibold">✓ Correct</span>
                              )}
                              {isGraded && isSelected && !isTheCorrectAnswer && (
                                <span className="text-rose-600 text-xs font-semibold">✗ Incorrect</span>
                              )}
                            </label>
                          );
                        })}
                      </div>

                      {/* Explanation box after grading */}
                      {isGraded && (
                        <div className="mt-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 ml-9 leading-relaxed">
                          <p className="font-semibold text-violet-700 mb-1">
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
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-40 rounded-xl font-semibold text-xs text-white transition-all shadow-sm shadow-blue-500/20"
                  >
                    Check Answers
                  </button>
                </div>
              ) : (
                <div className="flex justify-between items-center pt-2">
                  <button
                    onClick={handleGenerateQuiz}
                    disabled={generatingQuiz}
                    className="text-xs text-violet-700 hover:text-violet-900 underline font-semibold"
                  >
                    Generate another quiz
                  </button>
                  <button
                    onClick={() => {
                      setSelectedAnswers({});
                      setIsGraded(false);
                    }}
                    className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 rounded-xl font-semibold text-xs text-white transition-all shadow-sm shadow-violet-500/20"
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
    </div>
  );
}