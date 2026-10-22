import { useState } from 'react';
import type { Scenario } from '../lib/scenarios';

interface MissionChecklistCardProps {
  scenario: Scenario;
  language: string;
  onToggleObjective: (objectiveId: string) => void;
}

export default function MissionChecklistCard({
  scenario,
  language,
  onToggleObjective,
}: MissionChecklistCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeHintId, setActiveHintId] = useState<string | null>(null);

  const completedCount = scenario.objectives.filter((o) => o.completed).length;
  const totalCount = scenario.objectives.length;
  const percentComplete = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const isAllComplete = totalCount > 0 && completedCount === totalCount;

  return (
    <div className="bg-white dark:bg-[#0d121f] border border-slate-200/90 dark:border-white/[0.08] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-2xl shadow-sm overflow-hidden mb-6 transition-all duration-200">
      {/* Top Banner */}
      <div className="px-4 py-3 sm:px-5 sm:py-3.5 bg-gradient-to-r from-slate-50 dark:from-[#0f1628] via-white dark:via-[#0d121f] to-slate-50/50 dark:to-[#0f1628] border-b border-slate-100 dark:border-white/[0.06] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-white dark:bg-[#151d30] border border-slate-200/80 dark:border-white/[0.08] shadow-xs flex items-center justify-center text-lg shrink-0">
            {scenario.icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight truncate">
                {scenario.title}
              </h2>
              <span className="text-[10px] font-mono uppercase tracking-wider font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-600/15 border border-blue-200/80 dark:border-blue-500/30 px-2 py-0.5 rounded-full">
                Mission Active
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
              <span className="font-medium text-slate-700 dark:text-slate-300">Tutor Persona:</span> {scenario.aiRole}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right hidden sm:block">
            <div className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300">
              {completedCount} / {totalCount} Done
            </div>
            <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">{percentComplete}%</div>
          </div>

          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors text-xs flex items-center gap-1 font-medium"
            title={isCollapsed ? 'Expand mission checklist' : 'Collapse mission checklist'}
          >
            <span className="hidden xs:inline text-[11px]">{isCollapsed ? 'Show Goals' : 'Hide'}</span>
            <span className="text-xs transition-transform duration-200" style={{ transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              ▲
            </span>
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-100 dark:bg-white/[0.06] h-1.5 overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${
            isAllComplete ? 'bg-emerald-500' : 'bg-blue-600'
          }`}
          style={{ width: `${percentComplete}%` }}
        />
      </div>

      {/* Mission Body */}
      {!isCollapsed && (
        <div className="p-4 sm:p-5 space-y-3.5">
          {/* Mission Objective Checklist */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
              <span>Mission Checklist</span>
              <span className="text-[11px] font-normal text-slate-400 dark:text-slate-500">
                AI automatically validates objectives as you speak
              </span>
            </div>

            <div className="grid gap-2">
              {scenario.objectives.map((obj, idx) => {
                const hint = obj.hints?.[language] || obj.hints?.English;
                const isHintOpen = activeHintId === obj.id;

                return (
                  <div
                    key={obj.id}
                    className={`p-3 rounded-xl border text-xs transition-all ${
                      obj.completed
                        ? 'bg-emerald-50/50 dark:bg-emerald-950/25 border-emerald-200/80 dark:border-emerald-800/50 text-emerald-950 dark:text-emerald-200'
                        : 'bg-white dark:bg-[#0f1628] hover:bg-slate-50/70 dark:hover:bg-[#131b31] border-slate-200/90 dark:border-white/[0.07] text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => onToggleObjective(obj.id)}
                          className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                            obj.completed
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'border border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 bg-white dark:bg-[#151d30]'
                          }`}
                          title={obj.completed ? 'Mark as incomplete' : 'Mark as complete'}
                        >
                          {obj.completed ? (
                            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          ) : (
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">{idx + 1}</span>
                          )}
                        </button>

                        <div className="min-w-0">
                          <p
                            className={`font-medium ${
                              obj.completed ? 'line-through text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {obj.text}
                          </p>

                          {/* Inline Hint Drawer */}
                          {isHintOpen && hint && (
                            <div className="mt-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/40 text-amber-900 dark:text-amber-200 text-[11px] space-y-1 animate-fadeIn">
                              <div className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1">
                                <span>💡 Authentic Phrasing Hint ({language}):</span>
                              </div>
                              <p className="font-mono text-xs italic bg-white/70 dark:bg-[#0d121f] px-2 py-1 rounded border border-amber-200/50 dark:border-amber-800/40">
                                &quot;{hint}&quot;
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {hint && (
                        <button
                          type="button"
                          onClick={() => setActiveHintId(isHintOpen ? null : obj.id)}
                          className={`text-[11px] px-2 py-1 rounded-md font-medium shrink-0 transition-colors ${
                            isHintOpen
                              ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                              : 'text-slate-500 dark:text-slate-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 border border-transparent'
                          }`}
                        >
                          {isHintOpen ? 'Close Hint' : '💡 Hint'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* All Completed Banner */}
          {isAllComplete && (
            <div className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-sm flex items-center justify-between gap-3 animate-fadeIn">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">🏆</span>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider">Mission Accomplished!</h4>
                  <p className="text-[11px] text-emerald-100">
                    You satisfied all scenario objectives with natural conversational fluency.
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono bg-white/20 px-2.5 py-1 rounded-lg font-semibold shrink-0">
                100% Score
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
