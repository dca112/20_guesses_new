"use client";

import { useRef, useState } from "react";
import type { RoomView, RoundView } from "@/lib/types";
import { Counter, History, Modal } from "./ui";
import { clientId, type Act } from "./useRoom";

export default function ChallengerDashboard({ view, round, act }: { view: RoomView; round: RoundView; act: Act }) {
  const [showSecret, setShowSecret] = useState(true);
  const [hintOpen, setHintOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const offers = round.hintOffers ?? [];
  const openOffer = offers.find((o) => o.status === "pending");
  const pastOffers = offers.filter((o) => o.status !== "pending").slice().reverse();
  const inflight = round.inflight;

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div className="card flex items-center justify-between gap-3 border-indigo-400/30 bg-indigo-500/10">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-widest text-indigo-300">Your secret person</div>
            <div className="truncate text-xl font-black text-white">{showSecret ? round.secret : "••••••••"}</div>
          </div>
          <button className="btn-secondary shrink-0" onClick={() => setShowSecret((s) => !s)}>
            {showSecret ? "Hide" : "Show"}
          </button>
        </div>

        <Counter round={round} />

        <div className="card">
          <h2 className="section-title">Waiting on you</h2>
          {!inflight ? (
            <p className="text-sm text-slate-400">
              The team is discussing privately. Approved questions and final guesses will appear here.
            </p>
          ) : inflight.type === "question" ? (
            <div>
              <div className="text-xs text-slate-400">Question from the team (proposed by {inflight.proposedByName})</div>
              <div className="mt-1 text-lg font-bold text-white">{inflight.content}</div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <button
                  className="btn-success py-3"
                  disabled={busy}
                  onClick={() => run(() => act({ type: "answer_question", proposalId: inflight.proposalId, answer: "yes" }))}
                >
                  Yes
                </button>
                <button
                  className="btn-danger py-3"
                  disabled={busy}
                  onClick={() => run(() => act({ type: "answer_question", proposalId: inflight.proposalId, answer: "no" }))}
                >
                  No
                </button>
                <button
                  className="btn-secondary py-3"
                  disabled={busy}
                  onClick={() => run(() => act({ type: "answer_question", proposalId: inflight.proposalId, answer: "unknown" }))}
                >
                  Unknown
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">Use Unknown only when there&apos;s no clear answer. It still costs the team a question.</p>
            </div>
          ) : (
            <div>
              <div className="text-xs text-slate-400">Final guess from the team (proposed by {inflight.proposedByName})</div>
              <div className="mt-1 text-lg font-bold text-white">Is it {inflight.content}?</div>
              <p className="mt-1 text-xs text-slate-500">
                Accept spelling variations and aliases that clearly identify <span className="text-slate-300">{round.secret}</span>.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  className="btn-success py-3"
                  disabled={busy}
                  onClick={() => run(() => act({ type: "validate_guess", proposalId: inflight.proposalId, correct: true }))}
                >
                  Correct
                </button>
                <button
                  className="btn-danger py-3"
                  disabled={busy}
                  onClick={() => run(() => act({ type: "validate_guess", proposalId: inflight.proposalId, correct: false }))}
                >
                  Incorrect
                </button>
              </div>
            </div>
          )}
        </div>

        <History items={round.history} />
      </div>

      <div className="space-y-4">
        <div className="card">
          <h2 className="section-title">Hints</h2>
          {openOffer ? (
            <div className="rounded-xl border border-violet-400/30 bg-violet-500/10 p-3">
              <div className="text-xs font-bold uppercase tracking-widest text-violet-300">
                Offered · {openOffer.category} · {openOffer.cost} question{openOffer.cost === 1 ? "" : "s"}
              </div>
              <div className="mt-1 text-sm text-white">{openOffer.text}</div>
              <div className="mt-2 text-xs text-slate-400">The team is deciding whether to accept it.</div>
              <button
                className="btn-ghost mt-2 px-0 text-xs"
                onClick={() => act({ type: "withdraw_hint", proposalId: openOffer.id })}
              >
                Withdraw offer
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-400">
                Offer the team a hint for a price in questions. They see only the category and cost until they accept.
              </p>
              <button
                className="btn-primary mt-3 w-full"
                disabled={!!inflight || round.remaining < 1}
                onClick={() => setHintOpen(true)}
              >
                Offer a hint
              </button>
              {inflight && <p className="mt-2 text-xs text-slate-500">Resolve the pending action first.</p>}
            </>
          )}
          {pastOffers.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {pastOffers.map((o) => (
                <li key={o.id} className="flex items-start justify-between gap-2 rounded-lg bg-black/20 px-3 py-2 text-xs">
                  <span className="min-w-0 text-slate-300">
                    <span className="font-semibold">{o.category}</span> — {o.text}
                  </span>
                  <span
                    className={`shrink-0 font-bold uppercase ${
                      o.status === "resolved" ? "text-emerald-300" : "text-slate-500"
                    }`}
                  >
                    {o.status === "resolved" ? "accepted" : o.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card text-sm text-slate-400">
          <h2 className="section-title">Team</h2>
          <p>
            {round.guesserIds.length} Guesser{round.guesserIds.length === 1 ? "" : "s"} ·{" "}
            {round.requiredVotes} vote{round.requiredVotes === 1 ? "" : "s"} needed to approve anything.
          </p>
          <p className="mt-1 text-xs text-slate-500">Team chat and voting are private to the Guessers.</p>
        </div>

        {view.me?.isHost && <AbortButton act={act} />}
      </div>

      <HintModal open={hintOpen} onClose={() => setHintOpen(false)} act={act} round={round} />
    </div>
  );
}

export function AbortButton({ act }: { act: Act }) {
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <div className="card border-rose-500/30">
      <p className="text-sm text-slate-300">Abort this round and return everyone to the lobby?</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="btn-danger" onClick={() => act({ type: "abort_round" })}>
          Abort round
        </button>
        <button className="btn-secondary" onClick={() => setConfirm(false)}>
          Keep playing
        </button>
      </div>
    </div>
  ) : (
    <button className="btn-ghost w-full text-rose-300" onClick={() => setConfirm(true)}>
      Host: abort round
    </button>
  );
}

function HintModal({ open, onClose, act, round }: { open: boolean; onClose: () => void; act: Act; round: RoundView }) {
  const [category, setCategory] = useState("");
  const [text, setText] = useState("");
  const [cost, setCost] = useState(2);
  const [busy, setBusy] = useState(false);
  const idRef = useRef(clientId());
  const max = round.remaining;
  const presets = ["Geographical location", "Profession", "Era", "Achievement", "Initials"];
  return (
    <Modal open={open} onClose={onClose} title="Offer a hint">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = await act({ type: "offer_hint", category, text, cost, clientId: idRef.current });
          setBusy(false);
          if (ok) {
            setCategory("");
            setText("");
            idRef.current = clientId();
            onClose();
          }
        }}
      >
        <div>
          <label className="label">Category (visible to the team)</label>
          <input className="input" maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Geographical location" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button type="button" key={p} className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10" onClick={() => setCategory(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Hint (hidden until accepted)</label>
          <textarea className="input min-h-20" maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder="The person is from India" />
        </div>
        <div>
          <label className="label">Cost in questions</label>
          <div className="flex items-center gap-3">
            <button type="button" className="btn-secondary px-3" onClick={() => setCost((c) => Math.max(1, c - 1))}>
              −
            </button>
            <input
              className="input w-20 text-center"
              type="number"
              min={1}
              max={max}
              value={cost}
              onChange={(e) => setCost(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
            <button type="button" className="btn-secondary px-3" onClick={() => setCost((c) => Math.min(max, c + 1))}>
              +
            </button>
            <span className="text-xs text-slate-400">
              Counter becomes {round.questionsConsumed + cost}/{round.maxQuestions}
            </span>
          </div>
          {cost > max && <p className="mt-1 text-xs text-rose-300">Only {max} questions remain.</p>}
        </div>
        <p className="text-xs text-slate-500">Once offered, the hint and cost can&apos;t be edited — withdraw it and make a new offer instead.</p>
        <button className="btn-primary w-full py-3" disabled={busy || !category.trim() || !text.trim() || cost < 1 || cost > max}>
          {busy ? "Offering…" : "Offer hint"}
        </button>
      </form>
    </Modal>
  );
}
