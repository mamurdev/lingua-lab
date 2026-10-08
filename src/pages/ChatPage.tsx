import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

type Message = { id: string; role: 'user' | 'assistant'; content: string; sequence: number; };
type Conversation = { language: string; level: string; };

export default function ChatPage() {
  const { id } = useParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [convDetails, setConvDetails] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Audio state
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [audioLoadingId, setAudioLoadingId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<Record<string, string>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const audioUrlsRef = useRef<Record<string, string>>({});

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
      const { data: msgData } = await supabase.from('messages').select('*').eq('conversation_id', id).order('sequence', { ascending: true });
      if (msgData) setMessages(msgData);
    };

    if (id) fetchInitialData();
  }, [id]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !id) return;

    const newMessage = input;
    setInput('');
    setLoading(true);

    // Save user message to UI & Database
    const userSeq = messages.length + 1;
    const tempUserMsg: Message = { id: Date.now().toString(), role: 'user', content: newMessage, sequence: userSeq };
    setMessages((prev) => [...prev, tempUserMsg]);
    await supabase.from('messages').insert([{ conversation_id: id, role: 'user', content: newMessage, sequence: userSeq }]);

    try {
      // Call the Express backend
      const response = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: newMessage,
          language: convDetails?.language || 'English',
          level: convDetails?.level || 'Beginner',
          conversationHistory: messages
        }),
      });

      const data = await response.json();

      // Save AI reply to UI & Database
      if (data.reply) {
        const aiSeq = userSeq + 1;
        const tempAiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: data.reply, sequence: aiSeq };
        setMessages((prev) => [...prev, tempAiMsg]);
        await supabase.from('messages').insert([{ conversation_id: id, role: 'assistant', content: data.reply, sequence: aiSeq }]);
      }
    } catch (error) {
      console.error("Failed to fetch AI response:", error);
    }

    setLoading(false);
  };

  const playAudio = async (msg: Message) => {
    // If audio is already loaded, toggle play/pause on the existing audio element
    const existingAudio = audioRefs.current[msg.id];
    if (audioUrls[msg.id] && existingAudio) {
      if (existingAudio.paused) {
        // Pause all other audio elements on the page first
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

      const response = await fetch('http://localhost:3000/api/speech', {
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

      // Explicitly type blob as audio/mpeg for proper browser seeking
      const audioBlob = new Blob([blob], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(audioBlob);

      // Pause any currently playing audio across all messages
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

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      <header className="p-4 bg-gray-800 border-b border-gray-700 flex justify-between items-center shadow-md">
        <h1 className="text-xl font-bold text-blue-400">Practice Session</h1>
        <Link to="/" className="text-sm px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded font-medium transition-colors">
          ← Back to Dashboard
        </Link>
      </header>

      <main className="flex-1 p-4 overflow-y-auto space-y-4 max-w-4xl w-full mx-auto">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 mt-10 p-6 bg-gray-800/50 rounded-lg border border-dashed border-gray-700">
            Send your first message to begin the conversation!
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] p-3.5 rounded-lg text-sm sm:text-base ${
                  msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-100 rounded-bl-none'
                }`}>
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

                    {/* Unified native audio player: controls play/pause and draggable seeking */}
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
                            // Automatically pause any other voice when this one plays
                            Object.values(audioRefs.current).forEach((other) => {
                              if (other && other !== e.currentTarget) {
                                other.pause();
                              }
                            });
                          }}
                        />
                      </div>
                    )}

                    {/* Visible error message if request fails */}
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
            className="flex-1 bg-gray-900 p-3.5 rounded border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:opacity-50 transition-all"
          />
          <button 
            type="submit" 
            disabled={loading || !input.trim()}
            className="px-8 py-3.5 bg-blue-600 hover:bg-blue-700 rounded font-bold transition-colors disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}