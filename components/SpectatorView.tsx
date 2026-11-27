"use client";

import type { RoomView, RoundView } from "@/lib/types";
import { AbortButton } from "./ChallengerDashboard";
import { Counter, History } from "./ui";
import type { Act } from "./useRoom";

/** Players who joined after the round started wait for the next round. */
export default function SpectatorView({ view, round, act }: { view: RoomView; round: RoundView; act: Act }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="card border-sky-400/30 bg-sky-500/10 text-sm text-sky-100">
        A round is in progress. You&apos;ll join as a Guesser from the next round — meanwhile you can follow along.
      </div>
      <Counter round={round} />
      {round.inflight && (
        <div className="card text-sm text-slate-300">
          Waiting on {round.challengerName}:{" "}
          <span className="font-semibold text-white">
            {round.inflight.content}
          </span>
        </div>
      )}
      <History items={round.history} />
      {view.me?.isHost && <AbortButton act={act} />}
    </div>
  );
}
