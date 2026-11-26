"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const NAME_KEY = "tg_name";

export default function Landing() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {}
  }, []);

  function remember() {
    try {
      localStorage.setItem(NAME_KEY, name.trim());
    } catch {}
  }

  async function create() {
    if (!name.trim()) return setError("Enter a display name first");
    setBusy("create");
    setError(null);
    remember();
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not create room");
      router.push(`/room/${json.code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function join() {
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!name.trim()) return setError("Enter a display name first");
    if (!c) return setError("Enter the room code");
    setBusy("join");
    setError(null);
    remember();
    try {
      const res = await fetch(`/api/rooms/${c}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not join room");
      router.push(`/room/${c}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500 text-2xl font-black text-white shadow-lg shadow-indigo-500/30">
          20
        </div>
        <h1 className="text-3xl font-black tracking-tight text-white">20 Guesses</h1>
        <p className="mt-2 text-sm text-slate-400">
          One secret person. One team. Twenty questions to figure it out — together.
        </p>
      </div>

      <div className="card space-y-5">
        <div>
          <label className="label" htmlFor="name">
            Your display name
          </label>
          <input
            id="name"
            className="input"
            placeholder="e.g. Neha"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="nickname"
          />
        </div>

        <button className="btn-primary w-full py-3" onClick={create} disabled={busy !== null}>
          {busy === "create" ? "Creating…" : "Create game"}
        </button>

        <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-slate-500">
          <div className="h-px flex-1 bg-white/10" /> or join <div className="h-px flex-1 bg-white/10" />
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <input
            className="input font-mono uppercase tracking-widest"
            placeholder="ROOM CODE"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="Room code"
          />
          <button className="btn-secondary shrink-0" disabled={busy !== null} type="submit">
            {busy === "join" ? "Joining…" : "Join"}
          </button>
        </form>

        {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      </div>

      <details className="mt-6 text-sm text-slate-400">
        <summary className="cursor-pointer select-none text-center text-slate-300">How to play</summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li>The host shares the invite link and picks a Challenger.</li>
          <li>The Challenger secretly chooses a person.</li>
          <li>Guessers chat privately, propose yes/no questions and vote — a strict majority sends it.</li>
          <li>The Challenger can offer hints that cost questions. The team votes before it&apos;s revealed.</li>
          <li>Guess the person before 20 questions are used up to win.</li>
        </ul>
      </details>
    </main>
  );
}
