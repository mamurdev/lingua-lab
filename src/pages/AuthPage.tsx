import { useState } from "react";
import { supabase } from "../lib/supabase";
import ThemeToggle from "../components/ThemeToggle";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setIsError(false);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        setMessage("Signed in successfully");
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage("Account created. Check your email for verification.");
      }
    } catch (error) {
      setIsError(true);
      if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage(String(error));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-[#07090e] text-slate-900 dark:text-slate-100 flex flex-col justify-center items-center p-4 sm:p-6 relative overflow-hidden font-sans transition-colors duration-200">
      {/* Top right theme toggle */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* Subtle ambient decorative gradient */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-80 bg-gradient-to-b from-blue-100/50 dark:from-blue-600/10 via-slate-50 dark:via-[#07090e] to-transparent blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm relative z-10 space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-lg shadow-md shadow-blue-500/30">
            LL
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Lingua Lab</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-normal">
            AI dialogue practice and pronunciation journal
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-white dark:bg-[#0d121f] border border-slate-200/90 dark:border-white/[0.08] rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-200/50 dark:shadow-2xl dark:shadow-black/70 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] space-y-5 transition-colors duration-200">
          {/* Segmented Auth Mode Switch */}
          <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-white/[0.05] border border-slate-200/80 dark:border-white/[0.08] rounded-xl text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setIsLogin(true);
                setMessage("");
              }}
              className={`py-2 rounded-lg transition-all ${
                isLogin
                  ? "bg-white dark:bg-[#162036] text-slate-900 dark:text-white shadow-xs border border-transparent dark:border-white/[0.1] font-semibold"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsLogin(false);
                setMessage("");
              }}
              className={`py-2 rounded-lg transition-all ${
                !isLogin
                  ? "bg-white dark:bg-[#162036] text-slate-900 dark:text-white shadow-xs border border-transparent dark:border-white/[0.1] font-semibold"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#090d16] border border-slate-200 dark:border-white/[0.08] rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-[#12192b] focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/20 transition-all"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#090d16] border border-slate-200 dark:border-white/[0.08] rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-[#12192b] focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/20 transition-all"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 shadow-sm shadow-blue-500/25 flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Processing...</span>
                </>
              ) : isLogin ? (
                "Sign In"
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          {message && (
            <div
              className={`p-3 rounded-xl text-xs flex items-start gap-2 border ${
                isError
                  ? "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300"
                  : "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300"
              }`}
            >
              <span className="shrink-0">{isError ? "⚠️" : "✓"}</span>
              <span className="leading-relaxed font-medium">{message}</span>
            </div>
          )}
        </div>

        {/* Footer info */}
        <p className="text-center text-xs text-slate-400 dark:text-slate-500 font-medium">
          Protected by Supabase Row-Level Security
        </p>
      </div>
    </div>
  );
}
