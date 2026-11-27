"use client";

import { useState } from "react";
import type { Answer, HistoryItem, PlayerView, RoundView } from "@/lib/types";

export function Counter({ round }: { round: RoundView }) {
  const pct = Math.min(100, (round.questionsConsumed / round.maxQuestions) * 100);
  const danger = round.remaining <= 3;
  return (
    <div className="card">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">Round {round.number}</div>
          <div className="mt-0.5 text-sm text-slate-300">
            Challenger: <span className="font-semibold text-white">{round.challengerName}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black tabular-nums text-white">
            {round.questionsConsumed}
            <span className="text-base font-semibold text-slate-500"> / {round.maxQuestions}</span>
          </div>
          <div className={`text-xs font-semibold ${danger ? "text-rose-400" : "text-slate-400"}`}>
            {round.remaining} remaining
          </div>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-500 ${danger ? "bg-rose-500" : "bg-indigo-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function AnswerBadge({ answer }: { answer: Answer | null }) {
  if (!answer) return <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-300">Awaiting</span>;
  const styles: Record<Answer, string> = {
    yes: "bg-emerald-500/15 text-emerald-300",
    no: "bg-rose-500/15 text-rose-300",
    unknown: "bg-slate-500/20 text-slate-300",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${styles[answer]}`}>{answer}</span>
  );
}

export function History({ items, emptyText = "No questions asked yet." }: { items: HistoryItem[]; emptyText?: string }) {
  return (
    <div className="card">
      <h2 className="section-title">Question history</h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : (
        <ol className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 rounded-xl bg-black/20 px-3 py-2.5">
              {item.kind === "question" && (
                <>
                  <div className="min-w-0">
                    <div className="text-sm text-white">
                      <span className="mr-1.5 text-slate-500">Q{item.number}.</span>
                      {item.question}
                    </div>
                    <div className="text-xs text-slate-500">by {item.proposedBy}</div>
                  </div>
                  <AnswerBadge answer={item.answer} />
                </>
              )}
              {item.kind === "hint" && (
                <>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wide text-violet-300">
                      Hint · {item.category}
                    </div>
                    <div className="text-sm text-white">{item.text}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-bold text-violet-300">
                    −{item.cost}
                  </span>
                </>
              )}
              {item.kind === "guess" && (
                <>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wide text-sky-300">🎯 Name Guess</div>
                    <div className="text-sm text-white">{item.name}</div>
                    <div className="text-xs text-slate-500">by {item.proposedBy}</div>
                  </div>
                  {item.correct === null ? (
                    <AnswerBadge answer={null} />
                  ) : item.correct ? (
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-bold text-emerald-300">Correct!</span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-bold text-rose-300">Incorrect guess</span>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function PlayerList({
  players,
  highlight,
  meId,
}: {
  players: PlayerView[];
  highlight?: Record<string, string>;
  meId?: string;
}) {
  return (
    <ul className="space-y-1.5">
      {players.map((p) => (
        <li key={p.id} className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${p.online ? "bg-emerald-400" : "bg-slate-600"}`}
              title={p.online ? "Online" : "Offline"}
            />
            <span className="truncate text-sm text-white">
              {p.name}
              {p.id === meId && <span className="text-slate-500"> (you)</span>}
            </span>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {highlight?.[p.id] && (
              <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[11px] font-bold text-indigo-300">
                {highlight[p.id]}
              </span>
            )}
            {p.isHost && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">Host</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function InviteLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/room/${code}` : `/room/${code}`;
  async function copy() {
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: "Join my 20 Guesses game", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div className="card">
      <h2 className="section-title">Invite friends</h2>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate rounded-xl bg-black/30 px-3 py-2.5 font-mono text-sm text-slate-300">
          {url}
        </div>
        <button className="btn-secondary shrink-0" onClick={copy}>
          {copied ? "Copied!" : "Share"}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Room code: <span className="font-mono font-bold tracking-widest text-slate-300">{code}</span>
      </p>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl border border-white/10 bg-[#121833] p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
