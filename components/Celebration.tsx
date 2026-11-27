"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomView, RoundView } from "@/lib/types";
import { audioUnlocked, playApplause } from "./sound";
import type { Act } from "./useRoom";

/**
 * Every client starts the celebration at the same server-clock moment:
 * round end + SYNC_DELAY_MS. That is long enough for every poller (1.5 s
 * interval) to have seen the result, so screens light up together.
 */
const SYNC_DELAY_MS = 2000;
const CONFETTI_MS = 5000;
const storageKey = (roundId: string) => `tg_celebrated_${roundId}`;

function alreadyCelebrated(roundId: string): boolean {
  try {
    return localStorage.getItem(storageKey(roundId)) === "1";
  } catch {
    return false;
  }
}
function markCelebrated(roundId: string) {
  try {
    localStorage.setItem(storageKey(roundId), "1");
  } catch {}
}

export type CelebrationPhase = "idle" | "drumroll" | "open";

/**
 * Drives the end-of-round reveal: a short drumroll until the shared start
 * moment (so no screen shows the result early), then the celebration.
 * Runs automatically once per round; a refresh afterwards goes straight to
 * the results (it can be replayed manually).
 */
export function useCelebration(round: RoundView | null | undefined, serverNow: () => number) {
  const [phase, setPhase] = useState<CelebrationPhase>("idle");
  const [replayKey, setReplayKey] = useState(0);
  const roundId = round?.status === "finished" ? round.id : null;
  const endedAt = round?.endedAt ?? null;

  useEffect(() => {
    if (!roundId) {
      setPhase("idle");
      return;
    }
    if (alreadyCelebrated(roundId)) return;
    const startAt = (endedAt ?? serverNow()) + SYNC_DELAY_MS;
    const delay = Math.max(0, Math.min(SYNC_DELAY_MS + 500, startAt - serverNow()));
    setPhase(delay > 0 ? "drumroll" : "open");
    if (delay === 0) {
      markCelebrated(roundId);
      return;
    }
    const t = setTimeout(() => {
      markCelebrated(roundId);
      setPhase("open");
    }, delay);
    return () => clearTimeout(t);
  }, [roundId, endedAt, serverNow]);

  const replay = useCallback(() => {
    setReplayKey((k) => k + 1);
    setPhase("open");
  }, []);
  const close = useCallback(() => setPhase("idle"), []);
  return { phase, close, replay, replayKey };
}

/** Shown on every screen between the deciding moment and the shared reveal. */
export function Drumroll() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#060914]/95 px-4 text-center backdrop-blur-md">
      <div className="animate-bounce text-6xl" aria-hidden>
        🥁
      </div>
      <div className="mt-4 text-2xl font-black text-white">The round is over…</div>
      <div className="mt-1 text-sm text-slate-400">And the winner is</div>
    </div>
  );
}

export default function Celebration({
  view,
  round,
  act,
  onClose,
}: {
  view: RoomView;
  round: RoundView;
  act: Act;
  onClose: () => void;
}) {
  const teamWon = round.winner === "guessers";
  const [needsTap, setNeedsTap] = useState(false);
  const stopSound = useRef<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);

  const startSound = useCallback(async () => {
    stopSound.current?.();
    stopSound.current = await playApplause();
    setNeedsTap(!(await audioUnlocked()));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let fire: ((opts: object) => void) | null = null;

    (async () => {
      const confetti = (await import("canvas-confetti")).default;
      if (cancelled) return;
      const colors = teamWon
        ? ["#34d399", "#6366f1", "#fbbf24", "#f472b6", "#38bdf8", "#ffffff"]
        : ["#fbbf24", "#f59e0b", "#a78bfa", "#6366f1", "#ffffff"];
      fire = (opts: object) => confetti({ colors, zIndex: 200, disableForReducedMotion: true, ...opts });
      // Opening blast, then streams from both sides.
      fire({ particleCount: 160, spread: 100, startVelocity: 55, origin: { y: 0.6 } });
      const end = Date.now() + CONFETTI_MS;
      timer = setInterval(() => {
        if (Date.now() > end) return clearInterval(timer);
        fire?.({ particleCount: 7, angle: 60, spread: 60, origin: { x: 0, y: 0.75 }, startVelocity: 60 });
        fire?.({ particleCount: 7, angle: 120, spread: 60, origin: { x: 1, y: 0.75 }, startVelocity: 60 });
      }, 120);
    })();

    startSound().catch(() => setNeedsTap(true));

    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("keydown", onKey);
      stopSound.current?.();
      import("canvas-confetti").then((m) => m.default.reset()).catch(() => {});
    };
  }, [teamWon, startSound, onClose]);

  const questions = round.history.filter((h) => h.kind === "question").length;
  const guesses = round.history.filter((h) => h.kind === "guess").length;
  const hintCost = round.history.reduce((sum, h) => (h.kind === "hint" ? sum + h.cost : sum), 0);
  const isHost = !!view.me?.isHost;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#060914]/85 px-4 py-8 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={teamWon ? "Guessing Team Wins!" : "Challenger Wins!"}
    >
      <div className="celebrate-pop w-full max-w-md text-center">
        <div className="text-6xl sm:text-7xl" aria-hidden>
          {teamWon ? "🏆" : "🎭"}
        </div>
        <div className="mt-3 text-xs font-bold uppercase tracking-[0.3em] text-slate-300">Round {round.number}</div>
        <h1
          className={`mt-2 bg-clip-text text-4xl font-black leading-tight text-transparent sm:text-5xl ${
            teamWon
              ? "bg-gradient-to-r from-emerald-300 via-sky-300 to-indigo-300"
              : "bg-gradient-to-r from-amber-200 via-amber-400 to-violet-300"
          }`}
        >
          {teamWon ? "Guessing Team Wins!" : "Challenger Wins!"}
        </h1>
        {!teamWon && <p className="mt-1 text-sm text-slate-300">{round.challengerName} stumped the team</p>}

        <div className="mt-7 rounded-3xl border border-white/15 bg-white/[0.06] p-5 shadow-2xl">
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">The secret person was</div>
          <div className="mt-1 break-words text-3xl font-black text-white sm:text-4xl">{round.secret}</div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            <Stat value={`${round.questionsConsumed}/${round.maxQuestions}`} label="questions used" strong />
            <Stat value={String(questions)} label={questions === 1 ? "question" : "questions"} />
            <Stat value={String(guesses)} label={guesses === 1 ? "name guess" : "name guesses"} />
          </div>
          {hintCost > 0 && (
            <div className="mt-2 text-xs text-violet-300">Includes {hintCost} spent on hints</div>
          )}
        </div>

        <div className="mt-6 space-y-2">
          <button
            className="btn-primary w-full py-3.5 text-base"
            disabled={busy}
            onClick={async () => {
              if (isHost) {
                setBusy(true);
                await act({ type: "back_to_lobby" });
                setBusy(false);
              }
              onClose();
            }}
          >
            Play Again
          </button>
          {!isHost && <p className="text-xs text-slate-400">The host picks the next Challenger.</p>}
          <div className="flex justify-center gap-2">
            {needsTap && (
              <button className="btn-secondary" onClick={() => startSound()}>
                🔊 Tap for sound
              </button>
            )}
            <button className="btn-ghost" onClick={onClose}>
              View results
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, strong }: { value: string; label: string; strong?: boolean }) {
  return (
    <div className={`rounded-2xl px-2 py-2.5 ${strong ? "bg-indigo-500/20" : "bg-black/25"}`}>
      <div className="text-xl font-black tabular-nums text-white">{value}</div>
      <div className="text-[11px] leading-tight text-slate-400">{label}</div>
    </div>
  );
}
