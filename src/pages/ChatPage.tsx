import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

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

export default function ChatPage() {
  const { id } = useParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [convDetails, setConvDetails] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Tab state: 'chat' | 'quiz'
  const [activeTab, setActiveTab] = useState<'chat' | 'quiz'>('chat');

  // Audio state (Milestone 3)
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [audioLoadingId, setAudioLoadingId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<Record<string, string>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const audioUrlsRef = useRef<Record<string, string>>({});

  // Quiz state (Milestone 4)
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [isGraded, setIsGraded] = useState(false);

  useEffect(() => {
    audioUrlsRef.current = audioUrls;
  }, [audioUrls]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(audioUrlsRef.current).forEach((url) => {
        URL.revokeObjectURL(url);
      });
    };
  }, []);

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

    const newMessage = input;
    setInput('');
    setLoading(true);

    // Optimistic UI — show user message immediately
    const tempUserMsg: Message = {
      id: `temp-user-${Date.now()}`,
      role: 'user',
      content: newMessage,
      sequence: messages.length + 1,
    };
    setMessages((prev) => [...prev, tempUserMsg]);

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
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Error ${response.status}`);
      }

      // Refresh messages from DB to get real IDs (needed for voice playback)
      const { data: refreshed } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', id)
        .order('sequence', { ascending: true });
      if (refreshed) setMessages(refreshed);
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove the optimistic message on failure, restore draft
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      setInput(newMessage);
    }

    setLoading(false);
  };

  const playAudio = async (msg: Message) => {
    const existingAudio = audioRefs.current[msg.id];
    if (audioUrls[msg.id] && existingAudio) {
      if (existingAudio.paused) {
        Object.values(audioRefs.current).forEach((el) => {
          if (el && el !== existingAudio) el.pause();
        });
        existingAudio.play().catch(console.error);
      } else {
        existingAudio.pause();
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

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* Top Header */}
      <header className="px-6 py-3.5 bg-gray-800 border-b border-gray-700 flex flex-wrap justify-between items-center gap-3 shadow-md">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="text-sm px-3.5 py-1.5 bg-gray-700 hover:bg-gray-600 rounded font-medium transition-colors"
          >
            ← Dashboard
          </Link>
          <div>
            <h1 className="text-lg font-bold text-blue-400">
              {convDetails?.language || 'Language'} Practice
            </h1>
            <p className="text-xs text-gray-400">
              Level: <span className="text-gray-300 font-medium">{convDetails?.level || 'Beginner'}</span> • {messages.length} messages
            </p>
          </div>
        </div>

        {/* View Switcher & Quiz Action */}
        <div className="flex items-center gap-3">
          <div className="bg-gray-900 p-1 rounded-lg border border-gray-700 flex items-center gap-1 text-xs">
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-3 py-1.5 rounded font-medium transition-colors ${
                activeTab === 'chat' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              💬 Conversation ({messages.length})
            </button>
            <button
              onClick={() => setActiveTab('quiz')}
              className={`px-3 py-1.5 rounded font-medium transition-colors ${
                activeTab === 'quiz' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              📝 Review Quiz {exercises.length > 0 && `(${exercises.length})`}
            </button>
          </div>

          <button
            onClick={handleGenerateQuiz}
            disabled={generatingQuiz || messages.length < 4}
            title={messages.length < 4 ? "Requires at least 2 complete turns (4 messages)" : "Generate review quiz from chat"}
            className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:hover:bg-purple-600 rounded text-xs font-bold transition-all shadow flex items-center gap-1.5"
          >
            {generatingQuiz ? (
              <>⏳ Generating Quiz...</>
            ) : (
              <>✨ Generate Quiz</>
            )}
          </button>
        </div>
      </header>

      {/* Main Area: Chat or Quiz */}
      {activeTab === 'chat' ? (
        <>
          <main className="flex-1 p-4 overflow-y-auto space-y-4 max-w-4xl w-full mx-auto">
            {messages.length === 0 ? (
              <div className="text-center text-gray-400 mt-12 p-8 bg-gray-800/50 rounded-lg border border-dashed border-gray-700">
                <p className="text-base font-medium text-gray-300 mb-1">Start your practice session!</p>
                <p className="text-sm text-gray-500">
                  Send a message to your tutor in {convDetails?.language || 'your target language'}.
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] p-3.5 rounded-lg text-sm sm:text-base ${
                      msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-100 rounded-bl-none'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>

                    {msg.role === 'assistant' && (
                      <div className="mt-3 pt-2.5 border-t border-gray-600/60 space-y-2">
                        {!audioUrls[msg.id] && (
                          <button
                            onClick={() => playAudio(msg)}
                            disabled={audioLoadingId === msg.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-gray-800 hover:bg-gray-600 border border-gray-600 transition-colors disabled:opacity-50"
                          >
                            {audioLoadingId === msg.id ? (
                              <>⏳ Generating audio...</>
                            ) : (
                              <>▶️ Listen</>
                            )}
                          </button>
                        )}

                        {audioUrls[msg.id] && (
                          <div className="mt-1 flex flex-col gap-1">
                            <audio
                              ref={(el) => {
                                audioRefs.current[msg.id] = el;
                              }}
                              src={audioUrls[msg.id]}
                              controls
                              autoPlay
                              preload="auto"
                              className="w-full h-8 rounded bg-gray-800 accent-blue-500"
                              onPlay={(e) => {
                                Object.values(audioRefs.current).forEach((other) => {
                                  if (other && other !== e.currentTarget) other.pause();
                                });
                              }}
                            />
                          </div>
                        )}

                        {audioError[msg.id] && (
                          <div className="text-xs text-red-400 bg-red-950/40 p-2 rounded border border-red-800/60">
                            ⚠️ {audioError[msg.id]}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {loading && <div className="flex justify-start text-gray-400 text-sm italic pl-2">AI is typing...</div>}
          </main>

          <footer className="p-4 bg-gray-800 border-t border-gray-700">
            <form className="flex gap-3 max-w-4xl mx-auto" onSubmit={sendMessage}>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your message..."
                disabled={loading}
                className="flex-1 bg-gray-900 p-3.5 rounded border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:opacity-50 transition-all text-sm sm:text-base"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="px-8 py-3.5 bg-blue-600 hover:bg-blue-700 rounded font-bold transition-colors disabled:opacity-50 text-sm sm:text-base"
              >
                Send
              </button>
            </form>
          </footer>
        </>
      ) : (
        /* Milestone 4: Interactive Quiz View */
        <main className="flex-1 p-6 overflow-y-auto max-w-3xl w-full mx-auto space-y-6">
          <div className="flex justify-between items-center pb-3 border-b border-gray-700">
            <div>
              <h2 className="text-xl font-bold text-purple-400">Conversation Review Quiz</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Practice the vocabulary and grammar you just used in your conversation.
              </p>
            </div>
            {messages.length < 4 && (
              <span className="text-xs text-amber-400 bg-amber-950/40 px-2.5 py-1 rounded border border-amber-800/50">
                ⚠️ Need at least 4 messages (2 turns) to generate
              </span>
            )}
          </div>

          {quizError && (
            <div className="p-3 bg-red-950/40 border border-red-800/60 rounded text-red-400 text-sm">
              ⚠️ {quizError}
            </div>
          )}

          {!currentQuiz ? (
            <div className="text-center p-10 bg-gray-800/40 rounded-xl border border-dashed border-gray-700 space-y-4">
              <div className="text-4xl">📝</div>
              <div>
                <h3 className="text-base font-semibold text-gray-300">No review quiz generated yet</h3>
                <p className="text-sm text-gray-400 max-w-md mx-auto mt-1">
                  Once you've exchanged a few practice messages, click the button below to generate a tailored 3-question quiz from your transcript!
                </p>
              </div>
              <button
                onClick={handleGenerateQuiz}
                disabled={generatingQuiz || messages.length < 4}
                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 rounded-lg text-sm font-bold transition-all shadow inline-flex items-center gap-2"
              >
                {generatingQuiz ? "⏳ Generating Quiz..." : "✨ Generate 3-Question Quiz"}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Score header if graded */}
              {isGraded && (
                <div className="p-4 bg-gray-800 border border-purple-500/40 rounded-xl flex justify-between items-center shadow-lg">
                  <div>
                    <h3 className="text-lg font-bold text-white">Quiz Results</h3>
                    <p className="text-sm text-gray-400">
                      You scored <span className="font-bold text-purple-400">{calculateScore()} / {currentQuiz.questions.length}</span> ({Math.round((calculateScore() / currentQuiz.questions.length) * 100)}%)
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedAnswers({});
                      setIsGraded(false);
                    }}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-semibold transition-colors"
                  >
                    🔄 Try Again
                  </button>
                </div>
              )}

              {/* 3 Questions */}
              <div className="space-y-6">
                {currentQuiz.questions.map((q, qIdx) => {
                  const userChoice = selectedAnswers[qIdx];
                  const isCorrect = userChoice === q.answerIndex;

                  return (
                    <div
                      key={qIdx}
                      className="p-5 bg-gray-800 rounded-xl border border-gray-700 space-y-3.5 shadow-md"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-900/60 border border-purple-500/50 text-purple-300 flex items-center justify-center text-xs font-bold">
                          {qIdx + 1}
                        </span>
                        <h4 className="text-base font-semibold text-gray-100">{q.prompt}</h4>
                      </div>

                      {/* 4 Radio Options */}
                      <div className="space-y-2 pl-9">
                        {q.options.map((option, optIdx) => {
                          const isSelected = userChoice === optIdx;
                          const isTheCorrectAnswer = optIdx === q.answerIndex;

                          let optionStyles = 'border-gray-700 bg-gray-900/60 hover:bg-gray-700/50 text-gray-200';

                          if (isGraded) {
                            if (isTheCorrectAnswer) {
                              optionStyles = 'border-green-600 bg-green-950/40 text-green-200 font-medium';
                            } else if (isSelected && !isTheCorrectAnswer) {
                              optionStyles = 'border-red-600 bg-red-950/40 text-red-200 font-medium';
                            } else {
                              optionStyles = 'border-gray-800 bg-gray-900/30 text-gray-500';
                            }
                          } else if (isSelected) {
                            optionStyles = 'border-blue-500 bg-blue-950/40 text-blue-200 font-medium';
                          }

                          return (
                            <label
                              key={optIdx}
                              onClick={() => handleSelectOption(qIdx, optIdx)}
                              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all text-sm ${optionStyles}`}
                            >
                              <input
                                type="radio"
                                name={`question-${qIdx}`}
                                checked={isSelected}
                                onChange={() => handleSelectOption(qIdx, optIdx)}
                                disabled={isGraded}
                                className="accent-purple-500 w-4 h-4 cursor-pointer"
                              />
                              <span className="flex-1">{option}</span>
                              {isGraded && isTheCorrectAnswer && (
                                <span className="text-green-400 text-xs font-bold">✓ Correct</span>
                              )}
                              {isGraded && isSelected && !isTheCorrectAnswer && (
                                <span className="text-red-400 text-xs font-bold">✗ Incorrect</span>
                              )}
                            </label>
                          );
                        })}
                      </div>

                      {/* Explanation box after grading */}
                      {isGraded && (
                        <div className="mt-3 p-3.5 bg-gray-900/80 rounded-lg border border-gray-700 text-xs text-gray-300 ml-9">
                          <p className="font-semibold text-purple-300 mb-1">
                            {isCorrect ? '💡 Great job!' : '💡 Explanation:'}
                          </p>
                          <p className="leading-relaxed">{q.explanation}</p>
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
                    className="px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-lg font-bold text-sm transition-all shadow"
                  >
                    Check Answers
                  </button>
                </div>
              ) : (
                <div className="flex justify-between items-center pt-2">
                  <button
                    onClick={handleGenerateQuiz}
                    disabled={generatingQuiz}
                    className="text-xs text-purple-400 hover:text-purple-300 underline font-medium"
                  >
                    Generate another quiz
                  </button>
                  <button
                    onClick={() => {
                      setSelectedAnswers({});
                      setIsGraded(false);
                    }}
                    className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 rounded-lg font-bold text-sm transition-all shadow"
                  >
                    🔄 Try Again
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      )}
    </div>
  );
}