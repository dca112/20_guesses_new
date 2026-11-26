"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProposalView, RoomView, RoundView } from "@/lib/types";
import { Counter, History, Modal } from "./ui";
import { clientId, type Act } from "./useRoom";

export default function GuesserDashboard({ view, round, act }: { view: RoomView; round: RoundView; act: Act }) {
  const [tab, setTab] = useState<"game" | "chat">("game");
  const [modal, setModal] = useState<"question" | "final_guess" | null>(null);
  const proposals = round.proposals ?? [];
  const pending = proposals.filter((p) => p.status === "pending");
  const hintOffers = pending.filter((p) => p.type === "hint");
  const teamProposals = pending.filter((p) => p.type !== "hint");
  const closed = proposals
    .filter((p) => (p.status === "rejected" || p.status === "cancelled") && p.type !== "hint")
    .slice(-5)
    .reverse();

  const chat = round.chat ?? [];
  const [seenChat, setSeenChat] = useState(chat.length);
  useEffect(() => {
    if (tab === "chat") setSeenChat(chat.length);
  }, [tab, chat.length]);
  const unread = Math.max(0, chat.length - seenChat);

  const blocked = !!round.inflight || round.remaining < 1;

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1 lg:hidden">
        <button className={`btn py-2 ${tab === "game" ? "bg-indigo-500 text-white" : "text-slate-300"}`} onClick={() => setTab("game")}>
          Game {pending.length > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] text-black">{pending.length}</span>}
        </button>
        <button className={`btn py-2 ${tab === "chat" ? "bg-indigo-500 text-white" : "text-slate-300"}`} onClick={() => setTab("chat")}>
          Team chat {unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] text-white">{unread}</span>}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <div className={`space-y-4 ${tab === "game" ? "" : "hidden lg:block"}`}>
          <Counter round={round} />

          {round.inflight && (
            <div className="card border-amber-400/30 bg-amber-500/10">
              <div className="text-xs font-bold uppercase tracking-widest text-amber-300">
                {round.inflight.type === "question" ? "Waiting for the answer" : "Final guess submitted"}
              </div>
              <div className="mt-1 text-base font-semibold text-white">
                {round.inflight.type === "final_guess" ? `Is it ${round.inflight.content}?` : round.inflight.content}
              </div>
              <div className="mt-1 text-xs text-amber-200/70">
                {round.challengerName} is{" "}
                {round.inflight.type === "question" ? "answering" : "checking"}… New proposals open once it&apos;s resolved.
              </div>
            </div>
          )}

          {hintOffers.map((p) => (
            <HintOfferCard key={p.id} p={p} round={round} act={act} />
          ))}

          <div className="card">
            <h2 className="section-title">Proposals</h2>
            {teamProposals.length === 0 ? (
              <p className="text-sm text-slate-500">
                No open proposals. Discuss in the team chat, then propose a question or a final guess.
              </p>
            ) : (
              <div className="space-y-3">
                {teamProposals.map((p) => (
                  <ProposalCard key={p.id} p={p} act={act} disabled={!!round.inflight} />
                ))}
              </div>
            )}
            {closed.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-slate-500">Recently closed ({closed.length})</summary>
                <ul className="mt-2 space-y-1">
                  {closed.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2 text-xs text-slate-400">
                      <span className="truncate">
                        {p.type === "final_guess" ? "Guess: " : ""}
                        {p.content}
                      </span>
                      <span className="shrink-0 uppercase">{p.status}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <History items={round.history} />
        </div>

        <div className={`${tab === "chat" ? "" : "hidden lg:block"}`}>
          <Chat view={view} round={round} act={act} />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0b1020]/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3">
          <button className="btn-primary py-3" disabled={blocked} onClick={() => setModal("question")}>
            Propose question
          </button>
          <button className="btn-secondary py-3" disabled={blocked} onClick={() => setModal("final_guess")}>
            Guess person
          </button>
        </div>
      </div>

      <ProposeModal kind={modal} onClose={() => setModal(null)} act={act} round={round} />
    </>
  );
}

function VoteBar({ p }: { p: ProposalView }) {
  const total = p.eligibleVoters || 1;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-white/10">
      <div className="bg-emerald-500 transition-all" style={{ width: `${(p.approvals / total) * 100}%` }} />
      <div className="bg-rose-500 transition-all" style={{ width: `${(p.rejections / total) * 100}%` }} />
    </div>
  );
}

function VoteSummary({ p }: { p: ProposalView }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
      <span>
        <span className="font-semibold text-emerald-300">{p.approvals} Approve</span> ·{" "}
        <span className="font-semibold text-rose-300">{p.rejections} Reject</span> · {p.pendingVotes} Pending
      </span>
      <span>
        {p.requiredVotes} of {p.eligibleVoters} required
      </span>
    </div>
  );
}

function VoteButtons({
  p,
  act,
  disabled,
  labels = ["Approve", "Reject"],
}: {
  p: ProposalView;
  act: Act;
  disabled?: boolean;
  labels?: [string, string];
}) {
  const [busy, setBusy] = useState(false);
  if (p.myVote) {
    return (
      <div className="mt-3 text-sm text-slate-400">
        You voted{" "}
        <span className={p.myVote === "approve" ? "font-semibold text-emerald-300" : "font-semibold text-rose-300"}>
          {p.myVote === "approve" ? labels[0] : labels[1]}
        </span>
      </div>
    );
  }
  const vote = async (v: "approve" | "reject") => {
    setBusy(true);
    await act({ type: "vote", proposalId: p.id, vote: v });
    setBusy(false);
  };
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button className="btn-success" disabled={busy || disabled} onClick={() => vote("approve")}>
        {labels[0]}
      </button>
      <button className="btn-danger" disabled={busy || disabled} onClick={() => vote("reject")}>
        {labels[1]}
      </button>
    </div>
  );
}

function ProposalCard({ p, act, disabled }: { p: ProposalView; act: Act; disabled: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
        {p.type === "final_guess" ? "Final guess" : "Proposed question"} — {p.proposedByName}
      </div>
      <div className="mt-1 text-base font-semibold text-white">
        {p.type === "final_guess" ? `Is it ${p.content}?` : p.content}
      </div>
      {p.type === "final_guess" && (
        <div className="text-xs text-slate-500">Wrong guesses cost 1 question; a correct one wins the round.</div>
      )}
      <div className="mt-3">
        <VoteBar p={p} />
      </div>
      <VoteSummary p={p} />
      <VoteButtons p={p} act={act} disabled={disabled} />
    </div>
  );
}

function HintOfferCard({ p, round, act }: { p: ProposalView; round: RoundView; act: Act }) {
  return (
    <div className="card border-violet-400/30 bg-violet-500/10">
      <div className="text-xs font-bold uppercase tracking-widest text-violet-300">Hint offer — {p.content}</div>
      <div className="mt-1 text-sm text-white">
        Cost: <span className="font-bold">{p.cost}</span> question{p.cost === 1 ? "" : "s"}{" "}
        <span className="text-slate-400">
          (counter becomes {round.questionsConsumed + p.cost}/{round.maxQuestions})
        </span>
      </div>
      <div className="mt-3">
        <VoteBar p={p} />
      </div>
      <VoteSummary p={p} />
      <VoteButtons p={p} act={act} disabled={!!round.inflight} labels={["Accept hint", "Reject hint"]} />
    </div>
  );
}

function ProposeModal({
  kind,
  onClose,
  act,
  round,
}: {
  kind: "question" | "final_guess" | null;
  onClose: () => void;
  act: Act;
  round: RoundView;
}) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const idRef = useRef(clientId());
  useEffect(() => {
    if (kind) {
      setContent("");
      idRef.current = clientId();
    }
  }, [kind]);
  const isGuess = kind === "final_guess";
  return (
    <Modal open={!!kind} onClose={onClose} title={isGuess ? "Guess the person" : "Propose a question"}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!content.trim() || !kind) return;
          setBusy(true);
          const ok = await act({ type: "propose", kind, content, clientId: idRef.current });
          setBusy(false);
          if (ok) onClose();
        }}
      >
        <input
          className="input"
          autoFocus
          maxLength={isGuess ? 100 : 280}
          placeholder={isGuess ? "Full name of the person" : "Is the person associated with sports?"}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <p className="text-xs text-slate-400">
          Proposing is free and counts as your Approve vote. It needs {round.requiredVotes} of {round.guesserIds.length}{" "}
          approvals.{" "}
          {isGuess
            ? "If approved, the Challenger checks it: correct wins, wrong costs 1 question."
            : "If approved, it's sent to the Challenger and costs 1 question."}
        </p>
        <button className="btn-primary w-full py-3" disabled={!content.trim() || busy}>
          {busy ? "Proposing…" : isGuess ? "Propose guess" : "Propose question"}
        </button>
      </form>
    </Modal>
  );
}

function Chat({ view, round, act }: { view: RoomView; round: RoundView; act: Act }) {
  const messages = useMemo(() => round.chat ?? [], [round.chat]);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    stick.current = true;
    const ok = await act({ type: "send_message", content, clientId: clientId() });
    if (!ok) setDraft(content);
  }

  return (
    <div className="card flex h-[calc(100dvh-220px)] flex-col lg:sticky lg:top-4 lg:h-[calc(100dvh-140px)]">
      <h2 className="section-title flex items-center justify-between">
        <span>Private team chat</span>
        <span className="font-normal normal-case tracking-normal text-slate-500">Hidden from {round.challengerName}</span>
      </h2>
      <div
        ref={listRef}
        className="-mx-1 flex-1 space-y-2 overflow-y-auto px-1"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 && <p className="text-sm text-slate-500">Say hi and start strategising. Messages are free.</p>}
        {messages.map((m) => {
          const mine = m.playerId === view.me?.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  mine ? "rounded-br-sm bg-indigo-500 text-white" : "rounded-bl-sm bg-white/10 text-slate-100"
                }`}
              >
                {!mine && <div className="text-[11px] font-bold text-indigo-300">{m.playerName}</div>}
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
              </div>
            </div>
          );
        })}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={send}>
        <input
          className="input"
          placeholder="Type a message…"
          maxLength={1000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn-primary shrink-0" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
