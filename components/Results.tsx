"use client";

import type { RoomView, RoundView } from "@/lib/types";
import { PastRounds } from "./Lobby";
import { History } from "./ui";
import type { Act } from "./useRoom";

export default function Results({
  view,
  round,
  act,
  onReplay,
}: {
  view: RoomView;
  round: RoundView;
  act: Act;
  onReplay: () => void;
}) {
  const teamWon = round.winner === "guessers";
  const iWon =
    (teamWon && round.myRole === "guesser") || (!teamWon && round.myRole === "challenger");
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div
        className={`card text-center ${teamWon ? "border-emerald-400/30 bg-emerald-500/10" : "border-amber-400/30 bg-amber-500/10"}`}
      >
        <div className="text-xs font-bold uppercase tracking-widest text-slate-300">Round {round.number} · Results</div>
        <h1 className="mt-2 text-3xl font-black text-white">
          {teamWon ? "Guessing Team Wins! 🎉" : "Challenger Wins!"}
        </h1>
        {round.myRole !== "spectator" && (
          <p className="mt-1 text-sm text-slate-300">{iWon ? "Nicely done." : "Better luck next round."}</p>
        )}
        <div className="mt-5 text-xs font-semibold uppercase tracking-widest text-slate-400">The secret person was</div>
        <div className="mt-1 text-2xl font-black text-white">{round.secret}</div>
        <div className="mt-4 text-sm text-slate-300">
          {round.questionsConsumed} of {round.maxQuestions} questions used
        </div>
        <button className="btn-ghost mt-3 text-xs" onClick={onReplay}>
          🎉 Replay celebration
        </button>
      </div>

      {view.me?.isHost ? (
        <button className="btn-primary w-full py-3" onClick={() => act({ type: "back_to_lobby" })}>
          Play Again — choose a new Challenger
        </button>
      ) : (
        <p className="text-center text-sm text-slate-400">Waiting for the host to start the next round…</p>
      )}

      <History items={round.history} emptyText="No questions were asked." />
      {view.pastRounds.length > 1 && <PastRounds view={view} />}
    </div>
  );
}
