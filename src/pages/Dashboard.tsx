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
};

export default function Dashboard({ session }: DashboardProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [language, setLanguage] = useState('Spanish');
  const [level, setLevel] = useState('Beginner');

  useEffect(() => {
    // Moving the fetch logic INSIDE the effect perfectly satisfies the strict linter
    const loadConversations = async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .order('created_at', { ascending: false });
        
      if (!error && data) {
        setConversations(data);
      }
    };

    loadConversations();
  }, []);

  const startPractice = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Appending .select() tells Supabase to return the newly created row instantly
    const { data, error } = await supabase.from('conversations').insert([{
      user_id: session.user.id,
      title: `${language} Practice (${level})`,
      language,
      level
    }]).select();
    
    if (!error && data) {
      // We grab the new row (data[0]) and stick it at the front of our current list
      setConversations(prev => [data[0], ...prev]); 
    } else {
      console.error("Error creating session:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        <div className="flex justify-between items-center border-b border-gray-700 pb-4">
          <h1 className="text-3xl font-bold text-blue-400">Lingua Lab</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{session.user.email}</span>
            <button 
              onClick={() => supabase.auth.signOut()} 
              className="px-4 py-2 bg-gray-800 hover:bg-red-900 border border-gray-700 rounded transition-colors text-sm"
            >
              Sign Out
            </button>
          </div>
        </div>
        
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg">
          <h2 className="text-xl font-semibold mb-4">Start New Session</h2>
          <form onSubmit={startPractice} className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">Target Language</label>
              <select 
                value={language} 
                onChange={e => setLanguage(e.target.value)} 
                className="w-full bg-gray-900 p-2.5 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              >
                <option>Spanish</option>
                <option>French</option>
                <option>Korean</option>
                <option>Japanese</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">Proficiency Level</label>
              <select 
                value={level} 
                onChange={e => setLevel(e.target.value)} 
                className="w-full bg-gray-900 p-2.5 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              >
                <option>Beginner</option>
                <option>Intermediate</option>
                <option>Advanced</option>
              </select>
            </div>
            <button 
              type="submit" 
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 rounded font-semibold transition-colors"
            >
              Start
            </button>
          </form>
        </div>

        <div className="space-y-4">
          <h3 className="text-xl font-semibold border-b border-gray-700 pb-2">Recent Sessions</h3>
          {conversations.length === 0 ? (
            <p className="text-gray-400 bg-gray-800/50 p-6 rounded-lg text-center border border-dashed border-gray-700">
              No sessions yet. Select a language above to begin!
            </p>
          ) : (
            <div className="grid gap-3">
              {conversations.map(conv => (
                <Link 
                  to={`/chat/${conv.id}`}
                  key={conv.id} 
                  className="bg-gray-800 p-4 rounded-lg border border-gray-700 flex justify-between items-center hover:border-blue-500 cursor-pointer transition-colors block"
                >
                  <div>
                    <h4 className="font-semibold text-lg">{conv.title}</h4>
                    <p className="text-sm text-gray-400">Language: {conv.language} • Level: {conv.level}</p>
                  </div>
                  <span className="text-blue-400 text-sm font-medium">Open Chat →</span>
                </Link>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
