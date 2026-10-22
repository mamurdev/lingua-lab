import { useState } from 'react';

export type GrammarDiff = {
  original: string;
  corrected: string;
  rule: string;
};

export type GrammarFeedback = {
  hasMistake: boolean;
  corrected?: string;
  explanation?: string;
  diff?: GrammarDiff[];
};

interface GrammarFeedbackCardProps {
  originalText: string;
  feedback: GrammarFeedback;
}

export default function GrammarFeedbackCard({ originalText, feedback }: GrammarFeedbackCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // If no mistakes, show positive reinforcement badge
  if (!feedback.hasMistake) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800 px-2.5 py-1 rounded-lg w-fit shadow-xs">
        <span>✓</span>
        <span>Accurate grammar</span>
      </div>
    );
  }

  const diffCount = feedback.diff?.length || 1;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!feedback.corrected) return;
    navigator.clipboard.writeText(feedback.corrected);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Render original sentence with highlighted mistake tokens
  const renderVisualDiff = () => {
    if (!feedback.diff || feedback.diff.length === 0) {
      return (
        <div className="text-xs space-y-1">
          <div className="text-slate-500 dark:text-slate-400 line-through">{originalText}</div>
          <div className="text-emerald-800 dark:text-emerald-400 font-bold">{feedback.corrected}</div>
        </div>
      );
    }

    return (
      <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 rounded-xl space-y-2">
        <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
          Correction Preview
        </div>
        <div className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed font-medium">
          {feedback.corrected}
        </div>
      </div>
    );
  };

  return (
    <div className="mt-1.5">
      {/* Expand/Collapse Toggle Pill */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all shadow-xs cursor-pointer ${
          isExpanded
            ? 'bg-amber-100 dark:bg-amber-900/50 border-amber-300 dark:border-amber-700/80 text-amber-900 dark:text-amber-200 ring-1 ring-amber-300/40'
            : 'bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100/80 dark:hover:bg-amber-900/40 border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300'
        }`}
      >
        <span>💡</span>
        <span>
          {diffCount === 1 ? '1 Grammar correction' : `${diffCount} Grammar corrections`}
        </span>
        <span className="text-[9px] font-mono opacity-70 ml-0.5">
          {isExpanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded Grammar Card */}
      {isExpanded && (
        <div className="mt-2 p-4 bg-white dark:bg-[#0d121f] border border-amber-200 dark:border-amber-800/40 rounded-2xl shadow-md dark:shadow-2xl space-y-3 text-left animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/[0.06] pb-2">
            <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <span>💡</span>
              <span>Grammar & Syntax Breakdown</span>
            </span>
            {feedback.corrected && (
              <button
                type="button"
                onClick={handleCopy}
                className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-600/15 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-500/30 transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy Corrected'}
              </button>
            )}
          </div>

          {/* Diff preview */}
          {renderVisualDiff()}

          {/* Explanation */}
          {feedback.explanation && (
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {feedback.explanation}
            </p>
          )}

          {/* Individual change chips */}
          {feedback.diff && feedback.diff.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
                Changes Made
              </div>
              <div className="grid gap-1.5">
                {feedback.diff.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded-xl bg-slate-50 dark:bg-[#090d16] border border-slate-200/80 dark:border-white/[0.07] flex items-start gap-2 text-xs"
                  >
                    <div className="flex items-center gap-1 shrink-0 font-mono font-medium">
                      <span className="line-through text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-200 dark:border-rose-900/60">
                        {item.original}
                      </span>
                      <span className="text-slate-400 dark:text-slate-500">→</span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-900/60">
                        {item.corrected}
                      </span>
                    </div>
                    {item.rule && (
                      <span className="text-slate-500 dark:text-slate-400 text-[11px] self-center">
                        {item.rule}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
