"use client";

import { useEffect, useMemo, useState } from "react";
import type { RoomView } from "@/lib/types";
import { InviteLink, PlayerList } from "./ui";
import type { Act } from "./useRoom";

export default function Lobby({ view, act }: { view: RoomView; act: Act }) {
  const isHost = !!view.me?.isHost;
  const host = view.players.find((p) => p.isHost);
  const lastChallenger = useMemo(() => {
    const last = view.pastRounds[0];
    return last && view.players.some((p) => p.id === last.challengerId) ? last.challengerId : undefined;
  }, [view.pastRounds, view.players]);

  // Default to someone other than the previous Challenger.
  const suggested = useMemo(() => {
    if (view.players.length === 0) return undefined;
    if (!lastChallenger) return view.players.find((p) => p.id !== view.me?.id)?.id ?? view.players[0].id;
    const idx = view.players.findIndex((p) => p.id === lastChallenger);
    return view.players[(idx + 1) % view.players.length].id;
  }, [view.players, view.me?.id, lastChallenger]);

  const [selected, setSelected] = useState<string | undefined>(suggested);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!selected || !view.players.some((p) => p.id === selected)) setSelected(suggested);
  }, [suggested, selected, view.players]);

  const enough = view.players.length >= 2;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <InviteLink code={view.code} />
        <div className="card">
          <h2 className="section-title">Players ({view.players.length})</h2>
          <PlayerList players={view.players} meId={view.me?.id} />
          {!enough && <p className="mt-3 text-sm text-slate-400">Waiting for at least one more player to join…</p>}
        </div>
      </div>

      <div className="space-y-4">
        <div className="card">
          <h2 className="section-title">Next round</h2>
          {isHost ? (
            <>
              <p className="mb-3 text-sm text-slate-300">Choose who will be the Challenger:</p>
              <div className="space-y-1.5">
                {view.players.map((p) => (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition ${
                      selected === p.id ? "border-indigo-400 bg-indigo-500/15 text-white" : "border-white/10 bg-black/20 text-slate-300"
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        name="challenger"
                        className="accent-indigo-500"
                        checked={selected === p.id}
                        onChange={() => setSelected(p.id)}
                      />
                      {p.name}
                      {p.id === view.me?.id && <span className="text-slate-500">(you)</span>}
                    </span>
                    {p.id === lastChallenger && <span className="text-xs text-slate-500">last Challenger</span>}
                  </label>
                ))}
              </div>
              <button
                className="btn-primary mt-4 w-full py-3"
                disabled={!enough || !selected || busy}
                onClick={async () => {
                  setBusy(true);
                  await act({ type: "select_challenger", playerId: selected! });
                  setBusy(false);
                }}
              >
                Start round setup
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-300">
                Waiting for <span className="font-semibold text-white">{host?.name ?? "the host"}</span> to pick a
                Challenger and start the round.
              </p>
              {host && !host.online && (
                <button className="btn-secondary mt-3" onClick={() => act({ type: "claim_host" })}>
                  Host seems offline — become host
                </button>
              )}
            </>
          )}
        </div>

        {view.pastRounds.length > 0 && <PastRounds view={view} />}
      </div>
    </div>
  );
}

export function PastRounds({ view }: { view: RoomView }) {
  return (
    <div className="card">
      <h2 className="section-title">Previous rounds</h2>
      <ul className="space-y-1.5">
        {view.pastRounds.map((r) => (
          <li key={r.number} className="flex items-center justify-between gap-3 rounded-xl bg-black/20 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate text-white">
                Round {r.number}: {r.secret ?? <span className="italic text-slate-500">aborted</span>}
              </div>
              <div className="text-xs text-slate-500">Challenger {r.challengerName}</div>
            </div>
            {r.status === "finished" ? (
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  r.winner === "guessers" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
                }`}
              >
                {r.winner === "guessers" ? "Team won" : "Challenger won"} · {r.questionsConsumed}/20
              </span>
            ) : (
              <span className="shrink-0 text-xs text-slate-500">aborted</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
