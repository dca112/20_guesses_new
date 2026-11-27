"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RoundView } from "@/lib/types";
import Celebration, { Drumroll, useCelebration } from "./Celebration";
import ChallengerDashboard from "./ChallengerDashboard";
import GuesserDashboard from "./GuesserDashboard";
import Lobby from "./Lobby";
import Results from "./Results";
import Setup from "./Setup";
import { loadApplause } from "./sound";
import SpectatorView from "./SpectatorView";
import { useRoom } from "./useRoom";

export default function RoomClient({ code }: { code: string }) {
  const { view, serverNow, loadError, actionError, clearActionError, connected, act, join } = useRoom(code);
  const celebration = useCelebration(view?.status === "results" ? view.round : null, serverNow);
  const roundActive = view?.round?.status === "active";

  // Preload the applause while a round is running so the celebration starts instantly.
  useEffect(() => {
    if (roundActive) loadApplause().catch(() => {});
  }, [roundActive]);

  if (loadError?.status === 404) {
    return (
      <Centered>
        <h1 className="text-xl font-bold text-white">Room not found</h1>
        <p className="mt-2 text-sm text-slate-400">Check the invite link or room code.</p>
        <Link href="/" className="btn-primary mt-6">
          Back to start
        </Link>
      </Centered>
    );
  }
  if (!view) {
    return (
      <Centered>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
      </Centered>
    );
  }
  if (!view.me) return <JoinScreen code={code} hostCount={view.players.length} join={join} />;

  const round = view.round;
  let screen: React.ReactNode;
  if (view.status === "lobby" || !round) {
    screen = <Lobby view={view} act={act} />;
  } else if (view.status === "setup") {
    screen = <Setup view={view} round={round} act={act} />;
  } else if (view.status === "results") {
    screen = <Results view={view} round={round} act={act} onReplay={celebration.replay} />;
  } else if (round.myRole === "challenger") {
    screen = <ChallengerDashboard view={view} round={round} act={act} />;
  } else if (round.myRole === "guesser") {
    screen = <GuesserDashboard view={view} round={round} act={act} />;
  } else {
    screen = <SpectatorView view={view} round={round} act={act} />;
  }

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 pb-28 pt-4">
      <header className="mb-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-sm font-black text-white">
            20
          </span>
          <span className="font-bold text-white">20 Guesses</span>
        </Link>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-500 animate-pulse"}`} />
          <span className="font-mono tracking-widest">{view.code}</span>
          <span className="hidden sm:inline">· {view.me.name}</span>
        </div>
      </header>
      {!connected && (
        <div className="mb-3 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-300">Reconnecting…</div>
      )}
      {actionError && <ErrorToast message={actionError} onClose={clearActionError} />}
      {round && round.status === "active" && <IncorrectGuessBanner round={round} />}
      {screen}
      {celebration.phase === "drumroll" && <Drumroll />}
      {celebration.phase === "open" && view.status === "results" && round?.status === "finished" && (
        <Celebration key={celebration.replayKey} view={view} round={round} act={act} onClose={celebration.close} />
      )}
    </div>
  );
}

/** Shows "Incorrect guess" on every screen when an approved Name Guess is wrong. */
function IncorrectGuessBanner({ round }: { round: RoundView }) {
  const seen = useRef<Set<string> | null>(null);
  const [flash, setFlash] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    const guesses = round.history.filter((h) => h.kind === "guess");
    if (!seen.current) {
      // Don't replay old results after a refresh.
      seen.current = new Set(guesses.map((g) => g.id));
      return;
    }
    for (const g of guesses) {
      if (seen.current.has(g.id)) continue;
      seen.current.add(g.id);
      if (g.kind === "guess" && g.correct === false) setFlash({ id: g.id, name: g.name });
    }
  }, [round.history]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(t);
  }, [flash]);
  if (!flash) return null;
  return (
    <div
      role="status"
      className="celebrate-pop fixed inset-x-4 top-16 z-[70] mx-auto max-w-md rounded-2xl border border-rose-400/40 bg-rose-950/95 px-5 py-4 text-center shadow-2xl backdrop-blur"
    >
      <div className="text-lg font-black text-rose-200">❌ Incorrect guess</div>
      <div className="mt-0.5 text-sm text-rose-100/80">
        &ldquo;{flash.name}&rdquo; is not the secret person. The game continues.
      </div>
    </div>
  );
}

function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [message, onClose]);
  return (
    <div className="fixed inset-x-4 top-4 z-[60] mx-auto max-w-md rounded-xl border border-rose-500/30 bg-rose-950/90 px-4 py-3 text-sm text-rose-100 shadow-xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <span>{message}</span>
        <button onClick={onClose} className="text-rose-300" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">{children}</main>;
}

function JoinScreen({
  code,
  hostCount,
  join,
}: {
  code: string;
  hostCount: number;
  join: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try {
      setName(localStorage.getItem("tg_name") ?? "");
    } catch {}
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Enter a display name");
    setBusy(true);
    try {
      localStorage.setItem("tg_name", name.trim());
    } catch {}
    const err = await join(name);
    if (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <div className="mb-6 text-center">
        <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">You&apos;re invited to</div>
        <h1 className="mt-1 text-3xl font-black text-white">20 Guesses</h1>
        <p className="mt-2 font-mono text-sm tracking-widest text-indigo-300">{code}</p>
        <p className="mt-1 text-xs text-slate-500">
          {hostCount} player{hostCount === 1 ? "" : "s"} in the room
        </p>
      </div>
      <form className="card space-y-4" onSubmit={submit}>
        <div>
          <label className="label" htmlFor="join-name">
            Your display name
          </label>
          <input
            id="join-name"
            className="input"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rahul"
            autoFocus
          />
        </div>
        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy ? "Joining…" : "Join game"}
        </button>
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </form>
    </main>
  );
}
