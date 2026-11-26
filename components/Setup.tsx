"use client";

import { useState } from "react";
import type { RoomView, RoundView } from "@/lib/types";
import { PlayerList } from "./ui";
import type { Act } from "./useRoom";

export default function Setup({ view, round, act }: { view: RoomView; round: RoundView; act: Act }) {
  const isChallenger = round.challengerId === view.me?.id;
  const [secret, setSecret] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isChallenger) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className="card">
          <div className="text-xs font-semibold uppercase tracking-widest text-indigo-300">Round {round.number}</div>
          <h1 className="mt-1 text-2xl font-black text-white">You&apos;re the Challenger</h1>
          <p className="mt-2 text-sm text-slate-400">
            Secretly pick a person the team will try to identify. Only you will see this name until the round ends.
          </p>
          <form
            className="mt-5 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!secret.trim()) return;
              setBusy(true);
              await act({ type: "start_round", secretName: secret });
              setBusy(false);
            }}
          >
            <label className="label" htmlFor="secret">
              Secret person
            </label>
            <div className="flex gap-2">
              <input
                id="secret"
                className="input"
                type={reveal ? "text" : "password"}
                autoComplete="off"
                maxLength={100}
                placeholder="e.g. Sachin Tendulkar"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoFocus
              />
              <button type="button" className="btn-secondary shrink-0" onClick={() => setReveal((r) => !r)}>
                {reveal ? "Hide" : "Show"}
              </button>
            </div>
            <button className="btn-primary w-full py-3" disabled={!secret.trim() || busy}>
              {busy ? "Starting…" : "Start round"}
            </button>
          </form>
        </div>
        <button className="btn-ghost w-full" onClick={() => act({ type: "cancel_setup" })}>
          Cancel and return to lobby
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="card text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        <h1 className="text-xl font-bold text-white">{round.challengerName} is choosing a secret person…</h1>
        <p className="mt-2 text-sm text-slate-400">The round starts as soon as they&apos;re ready.</p>
      </div>
      <div className="card">
        <h2 className="section-title">Players</h2>
        <PlayerList players={view.players} meId={view.me?.id} highlight={{ [round.challengerId]: "Challenger" }} />
      </div>
      {view.me?.isHost && (
        <button className="btn-ghost w-full" onClick={() => act({ type: "cancel_setup" })}>
          Cancel setup and pick a different Challenger
        </button>
      )}
    </div>
  );
}
