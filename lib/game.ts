/**
 * Server-authoritative game engine.
 *
 * Every mutation runs in a single write transaction, re-reads the state it
 * depends on, and uses conditional updates (`... WHERE status = 'pending'`)
 * plus database constraints so that concurrent or repeated requests can never
 * double-submit an action or consume the budget twice.
 */
import type { Transaction } from "@libsql/client";
import { all, getDb, one, run, withTx, type Executor } from "./db";
import { MAX_QUESTIONS } from "./schema";
import type {
  Answer,
  ChatMessage,
  GameAction,
  HintOfferView,
  HistoryItem,
  InflightView,
  PastRoundView,
  PlayerView,
  ProposalView,
  RoomView,
  RoundRole,
  RoundView,
  VoteView,
} from "./types";

export class GameError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const ONLINE_WINDOW_MS = 15_000;
const HEARTBEAT_THROTTLE_MS = 5_000;
const HOST_CLAIM_AFTER_MS = 60_000;
const CHAT_LIMIT = 200;

/** Strict majority of eligible guessers. */
export function requiredVotes(eligible: number): number {
  return Math.floor(eligible / 2) + 1;
}

/* ------------------------------------------------------------------ rows */

interface RoomRow {
  id: string;
  invite_code: string;
  host_id: string | null;
  status: string;
  current_round_id: string | null;
  version: number;
}
interface PlayerRow {
  id: string;
  room_id: string;
  display_name: string;
  session_id: string;
  last_seen: number;
  joined_at: number;
}
interface RoundRow {
  id: string;
  room_id: string;
  number: number;
  challenger_id: string;
  status: string;
  questions_consumed: number;
  winner: string | null;
  created_at: number;
  ended_at: number | null;
}
interface ProposalRow {
  id: string;
  round_id: string;
  proposed_by: string;
  type: "question" | "hint" | "final_guess";
  content: string;
  question_cost: number;
  status: string;
  required_votes: number;
  eligible_voters: number;
  created_at: number;
  resolved_at: number | null;
}

/* --------------------------------------------------------------- helpers */

const now = () => Date.now();
const uid = () => crypto.randomUUID();

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function inviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function normalizeCode(code: string): string {
  return String(code ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function text(value: unknown, field: string, max: number): string {
  const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!s) throw new GameError(400, `${field} is required`);
  if (s.length > max) throw new GameError(400, `${field} must be at most ${max} characters`);
  return s;
}

function multiline(value: unknown, field: string, max: number): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) throw new GameError(400, `${field} is required`);
  if (s.length > max) throw new GameError(400, `${field} must be at most ${max} characters`);
  return s;
}

function optionalClientId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null;
}

async function bump(ex: Executor, roomId: string): Promise<void> {
  await run(ex, "UPDATE rooms SET version = version + 1 WHERE id = ?", [roomId]);
}

/* -------------------------------------------------------------- sessions */

export async function createRoom(sessionId: string, displayName: unknown): Promise<{ code: string }> {
  const name = text(displayName, "Display name", 40);
  return withTx(async (tx) => {
    let code = inviteCode();
    for (let i = 0; i < 5 && (await one(tx, "SELECT 1 FROM rooms WHERE invite_code = ?", [code])); i++) {
      code = inviteCode();
    }
    const roomId = uid();
    const playerId = uid();
    const t = now();
    await run(tx, "INSERT INTO rooms (id, invite_code, host_id, status, created_at) VALUES (?, ?, ?, 'lobby', ?)", [
      roomId,
      code,
      playerId,
      t,
    ]);
    await run(
      tx,
      "INSERT INTO players (id, room_id, display_name, session_id, last_seen, joined_at) VALUES (?, ?, ?, ?, ?, ?)",
      [playerId, roomId, name, sessionId, t, t],
    );
    return { code };
  });
}

export async function joinRoom(sessionId: string, rawCode: string, displayName: unknown): Promise<{ playerId: string }> {
  const code = normalizeCode(rawCode);
  return withTx(async (tx) => {
    const room = await one<RoomRow>(tx, "SELECT * FROM rooms WHERE invite_code = ?", [code]);
    if (!room) throw new GameError(404, "Room not found");
    const existing = await one<PlayerRow>(tx, "SELECT * FROM players WHERE room_id = ? AND session_id = ?", [
      room.id,
      sessionId,
    ]);
    const t = now();
    if (existing) {
      // Reconnection: same identity, optionally refreshed display name.
      const name =
        typeof displayName === "string" && displayName.trim() ? text(displayName, "Display name", 40) : null;
      await run(tx, "UPDATE players SET last_seen = ?, display_name = COALESCE(?, display_name) WHERE id = ?", [
        t,
        name,
        existing.id,
      ]);
      await bump(tx, room.id);
      return { playerId: existing.id };
    }
    const name = text(displayName, "Display name", 40);
    const count = await one<{ n: number }>(tx, "SELECT COUNT(*) AS n FROM players WHERE room_id = ?", [room.id]);
    if ((count?.n ?? 0) >= 50) throw new GameError(409, "Room is full");
    const playerId = uid();
    await run(
      tx,
      "INSERT INTO players (id, room_id, display_name, session_id, last_seen, joined_at) VALUES (?, ?, ?, ?, ?, ?)",
      [playerId, room.id, name, sessionId, t, t],
    );
    if (!room.host_id) await run(tx, "UPDATE rooms SET host_id = ? WHERE id = ?", [playerId, room.id]);
    await bump(tx, room.id);
    return { playerId };
  });
}

/* --------------------------------------------------------------- actions */

interface Ctx {
  tx: Transaction;
  room: RoomRow;
  me: PlayerRow;
  round: RoundRow | undefined;
  role: RoundRole | undefined;
  isHost: boolean;
}

async function loadCtx(tx: Transaction, sessionId: string, code: string): Promise<Ctx> {
  const room = await one<RoomRow>(tx, "SELECT * FROM rooms WHERE invite_code = ?", [code]);
  if (!room) throw new GameError(404, "Room not found");
  const me = await one<PlayerRow>(tx, "SELECT * FROM players WHERE room_id = ? AND session_id = ?", [
    room.id,
    sessionId,
  ]);
  if (!me) throw new GameError(403, "Join the room first");
  const round = room.current_round_id
    ? await one<RoundRow>(tx, "SELECT * FROM rounds WHERE id = ?", [room.current_round_id])
    : undefined;
  let role: RoundRole | undefined;
  if (round) {
    if (round.challenger_id === me.id) role = "challenger";
    else {
      const rp = await one<{ role: string }>(tx, "SELECT role FROM round_players WHERE round_id = ? AND player_id = ?", [
        round.id,
        me.id,
      ]);
      role = rp ? (rp.role as RoundRole) : "spectator";
    }
  }
  await run(tx, "UPDATE players SET last_seen = ? WHERE id = ?", [now(), me.id]);
  return { tx, room, me, round, role, isHost: room.host_id === me.id };
}

function requireHost(c: Ctx) {
  if (!c.isHost) throw new GameError(403, "Only the host can do that");
}
function requireActiveRound(c: Ctx): RoundRow {
  if (!c.round || c.round.status !== "active" || c.room.status !== "playing") {
    throw new GameError(409, "No round is in progress");
  }
  return c.round;
}
function requireGuesser(c: Ctx): RoundRow {
  const round = requireActiveRound(c);
  if (c.role !== "guesser") throw new GameError(403, "Only this round's Guessers can do that");
  return round;
}
function requireChallenger(c: Ctx): RoundRow {
  const round = requireActiveRound(c);
  if (c.role !== "challenger") throw new GameError(403, "Only the Challenger can do that");
  return round;
}

async function freshRound(tx: Executor, roundId: string): Promise<RoundRow> {
  const r = await one<RoundRow>(tx, "SELECT * FROM rounds WHERE id = ?", [roundId]);
  if (!r) throw new GameError(404, "Round not found");
  return r;
}

async function inflightProposal(tx: Executor, roundId: string): Promise<ProposalRow | undefined> {
  return one<ProposalRow>(tx, "SELECT * FROM proposals WHERE round_id = ? AND status = 'approved'", [roundId]);
}

async function guesserCount(tx: Executor, roundId: string): Promise<number> {
  const r = await one<{ n: number }>(
    tx,
    "SELECT COUNT(*) AS n FROM round_players WHERE round_id = ? AND role = 'guesser'",
    [roundId],
  );
  return r?.n ?? 0;
}

async function closePending(tx: Executor, roundId: string, exceptId: string | null, t: number): Promise<void> {
  await run(
    tx,
    "UPDATE proposals SET status = 'cancelled', resolved_at = ? WHERE round_id = ? AND status = 'pending' AND id <> ?",
    [t, roundId, exceptId ?? ""],
  );
}

async function finishRound(c: Ctx, roundId: string, winner: "guessers" | "challenger"): Promise<void> {
  const t = now();
  const changed = await run(
    c.tx,
    "UPDATE rounds SET status = 'finished', winner = ?, ended_at = ? WHERE id = ? AND status = 'active'",
    [winner, t, roundId],
  );
  if (!changed) return;
  await closePending(c.tx, roundId, null, t);
  await run(c.tx, "UPDATE rooms SET status = 'results' WHERE id = ?", [c.room.id]);
}

/**
 * Re-evaluates a pending proposal after a vote: approves it once a strict
 * majority approves, rejects it once approval is mathematically impossible.
 */
async function evaluateProposal(c: Ctx, proposalId: string): Promise<void> {
  const p = await one<ProposalRow>(c.tx, "SELECT * FROM proposals WHERE id = ?", [proposalId]);
  if (!p || p.status !== "pending") return;
  const tally = await one<{ approve: number; reject: number }>(
    c.tx,
    `SELECT COALESCE(SUM(vote = 'approve'), 0) AS approve, COALESCE(SUM(vote = 'reject'), 0) AS reject
       FROM votes WHERE proposal_id = ?`,
    [p.id],
  );
  const approve = Number(tally?.approve ?? 0);
  const reject = Number(tally?.reject ?? 0);
  const outstanding = Math.max(0, p.eligible_voters - approve - reject);
  const t = now();

  if (approve < p.required_votes) {
    if (approve + outstanding < p.required_votes) {
      await run(c.tx, "UPDATE proposals SET status = 'rejected', resolved_at = ? WHERE id = ? AND status = 'pending'", [
        t,
        p.id,
      ]);
    }
    return;
  }

  // Majority reached — approve atomically.
  const round = await freshRound(c.tx, p.round_id);
  if (round.status !== "active") return;
  const remaining = MAX_QUESTIONS - round.questions_consumed;
  const cost = p.type === "hint" ? p.question_cost : 1;
  if (cost > remaining || (await inflightProposal(c.tx, round.id))) {
    // Cannot be executed: budget exceeded (or another action in flight).
    await run(c.tx, "UPDATE proposals SET status = 'rejected', resolved_at = ? WHERE id = ? AND status = 'pending'", [
      t,
      p.id,
    ]);
    return;
  }

  if (p.type === "hint") {
    const ok = await run(
      c.tx,
      "UPDATE proposals SET status = 'resolved', resolved_at = ? WHERE id = ? AND status = 'pending'",
      [t, p.id],
    );
    if (!ok) return;
    await run(c.tx, "UPDATE hints SET revealed_at = ? WHERE proposal_id = ? AND revealed_at IS NULL", [t, p.id]);
    await run(c.tx, "UPDATE rounds SET questions_consumed = questions_consumed + ? WHERE id = ?", [cost, round.id]);
    await closePending(c.tx, round.id, p.id, t);
    if (round.questions_consumed + cost >= MAX_QUESTIONS) await finishRound(c, round.id, "challenger");
    return;
  }

  if (p.type === "final_guess") {
    // Name Guess: checked automatically against the secret, resolved at once,
    // and always consumes one question (correct or not).
    const ok = await run(
      c.tx,
      "UPDATE proposals SET status = 'resolved', resolved_at = ? WHERE id = ? AND status = 'pending'",
      [t, p.id],
    );
    if (!ok) return;
    const secret = await one<{ secret_name: string }>(c.tx, "SELECT secret_name FROM round_secrets WHERE round_id = ?", [
      round.id,
    ]);
    const correct = !!secret && namesMatch(p.content, secret.secret_name);
    await run(
      c.tx,
      `INSERT INTO guesses (id, proposal_id, round_id, guessed_name, is_correct, submitted_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uid(), p.id, round.id, p.content, correct ? 1 : 0, t, t],
    );
    await run(c.tx, "UPDATE rounds SET questions_consumed = questions_consumed + 1 WHERE id = ?", [round.id]);
    await closePending(c.tx, round.id, p.id, t);
    // A correct guess wins even when it uses the 20th question.
    if (correct) await finishRound(c, round.id, "guessers");
    else if (round.questions_consumed + 1 >= MAX_QUESTIONS) await finishRound(c, round.id, "challenger");
    return;
  }

  // Regular question: submitted to the Challenger, who must answer it.
  const ok = await run(c.tx, "UPDATE proposals SET status = 'approved' WHERE id = ? AND status = 'pending'", [p.id]);
  if (!ok) return;
  await closePending(c.tx, round.id, p.id, t);
  await run(c.tx, "INSERT INTO questions (id, proposal_id, round_id, question, asked_at) VALUES (?, ?, ?, ?, ?)", [
    uid(),
    p.id,
    round.id,
    p.content,
    t,
  ]);
  // An approved question consumes one question the moment it is submitted.
  await run(c.tx, "UPDATE rounds SET questions_consumed = questions_consumed + 1 WHERE id = ?", [round.id]);
}

/** Case-insensitive comparison that ignores leading and trailing spaces. */
export function namesMatch(guess: string, secret: string): boolean {
  return guess.trim().toLocaleLowerCase() === secret.trim().toLocaleLowerCase();
}

async function castVote(c: Ctx, proposalId: string, playerId: string, vote: "approve" | "reject"): Promise<boolean> {
  const inserted = await run(
    c.tx,
    "INSERT INTO votes (id, proposal_id, player_id, vote, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (proposal_id, player_id) DO NOTHING",
    [uid(), proposalId, playerId, vote, now()],
  );
  return inserted > 0;
}

export async function performAction(sessionId: string, rawCode: string, action: GameAction): Promise<void> {
  const code = normalizeCode(rawCode);
  if (!action || typeof action !== "object" || typeof action.type !== "string") {
    throw new GameError(400, "Invalid action");
  }
  await withTx(async (tx) => {
    const c = await loadCtx(tx, sessionId, code);
    await dispatch(c, action);
    await bump(tx, c.room.id);
  });
}

async function dispatch(c: Ctx, a: GameAction): Promise<void> {
  const { tx } = c;
  const t = now();
  switch (a.type) {
    case "select_challenger": {
      requireHost(c);
      if (c.room.status !== "lobby" && c.room.status !== "results") {
        throw new GameError(409, "A round is already in progress");
      }
      const target = await one<PlayerRow>(tx, "SELECT * FROM players WHERE id = ? AND room_id = ?", [
        String(a.playerId),
        c.room.id,
      ]);
      if (!target) throw new GameError(404, "Player not found");
      const players = await one<{ n: number }>(tx, "SELECT COUNT(*) AS n FROM players WHERE room_id = ?", [c.room.id]);
      if ((players?.n ?? 0) < 2) throw new GameError(409, "At least two players are needed");
      const last = await one<{ n: number }>(tx, "SELECT COALESCE(MAX(number), 0) AS n FROM rounds WHERE room_id = ?", [
        c.room.id,
      ]);
      const roundId = uid();
      await run(
        tx,
        "INSERT INTO rounds (id, room_id, number, challenger_id, status, created_at) VALUES (?, ?, ?, ?, 'setup', ?)",
        [roundId, c.room.id, (last?.n ?? 0) + 1, target.id, t],
      );
      await run(tx, "UPDATE rooms SET status = 'setup', current_round_id = ? WHERE id = ?", [roundId, c.room.id]);
      return;
    }

    case "cancel_setup": {
      if (c.room.status !== "setup" || !c.round || c.round.status !== "setup") {
        throw new GameError(409, "No round is being set up");
      }
      if (!c.isHost && c.round.challenger_id !== c.me.id) {
        throw new GameError(403, "Only the host or the Challenger can cancel");
      }
      await run(tx, "UPDATE rounds SET status = 'aborted', ended_at = ? WHERE id = ? AND status = 'setup'", [
        t,
        c.round.id,
      ]);
      await run(tx, "UPDATE rooms SET status = 'lobby' WHERE id = ?", [c.room.id]);
      return;
    }

    case "start_round": {
      if (c.room.status !== "setup" || !c.round || c.round.status !== "setup") {
        throw new GameError(409, "No round is being set up");
      }
      if (c.round.challenger_id !== c.me.id) throw new GameError(403, "Only the Challenger can start the round");
      const secret = text(a.secretName, "Secret person", 100);
      // Round membership is fixed at start: everyone currently in the room.
      const players = await all<{ id: string }>(tx, "SELECT id FROM players WHERE room_id = ?", [c.room.id]);
      const guessers = players.filter((p) => p.id !== c.me.id);
      if (guessers.length < 1) throw new GameError(409, "At least one Guesser is needed");
      await run(tx, "INSERT INTO round_secrets (round_id, secret_name) VALUES (?, ?)", [c.round.id, secret]);
      await run(tx, "INSERT INTO round_players (round_id, player_id, role) VALUES (?, ?, 'challenger')", [
        c.round.id,
        c.me.id,
      ]);
      for (const g of guessers) {
        await run(tx, "INSERT INTO round_players (round_id, player_id, role) VALUES (?, ?, 'guesser')", [
          c.round.id,
          g.id,
        ]);
      }
      const ok = await run(
        tx,
        "UPDATE rounds SET status = 'active', started_at = ?, questions_consumed = 0 WHERE id = ? AND status = 'setup'",
        [t, c.round.id],
      );
      if (!ok) throw new GameError(409, "Round already started");
      await run(tx, "UPDATE rooms SET status = 'playing' WHERE id = ?", [c.room.id]);
      return;
    }

    case "send_message": {
      if (!c.round || c.role !== "guesser") throw new GameError(403, "Only Guessers can use the team chat");
      if (c.round.status !== "active" && c.round.status !== "finished") {
        throw new GameError(409, "Chat is closed");
      }
      const content = multiline(a.content, "Message", 1000);
      await run(
        tx,
        `INSERT INTO messages (id, round_id, player_id, content, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (round_id, player_id, client_id) DO NOTHING`,
        [uid(), c.round.id, c.me.id, content, optionalClientId(a.clientId), t],
      );
      return;
    }

    case "propose": {
      const round = requireGuesser(c);
      const raw = a.kind as string;
      const kind =
        raw === "final_guess" || raw === "name_guess" ? "final_guess" : raw === "question" ? "question" : null;
      if (!kind) throw new GameError(400, "Unknown proposal type");
      const content =
        kind === "question" ? text(a.content, "Question", 280) : text(a.content, "Name Guess", 100);
      const clientId = optionalClientId(a.clientId);
      if (clientId) {
        const dup = await one(tx, "SELECT 1 FROM proposals WHERE round_id = ? AND proposed_by = ? AND client_id = ?", [
          round.id,
          c.me.id,
          clientId,
        ]);
        if (dup) return; // idempotent retry
      }
      if (MAX_QUESTIONS - round.questions_consumed < 1) throw new GameError(409, "No questions remaining");
      if (await inflightProposal(tx, round.id)) {
        throw new GameError(409, "Wait for the Challenger to resolve the current action");
      }
      const eligible = await guesserCount(tx, round.id);
      const proposalId = uid();
      await run(
        tx,
        `INSERT INTO proposals (id, round_id, proposed_by, type, content, question_cost, status, required_votes, eligible_voters, client_id, created_at)
         VALUES (?, ?, ?, ?, ?, 1, 'pending', ?, ?, ?, ?)`,
        [proposalId, round.id, c.me.id, kind, content, requiredVotes(eligible), eligible, clientId, t],
      );
      // The proposer automatically votes Approve.
      await castVote(c, proposalId, c.me.id, "approve");
      await evaluateProposal(c, proposalId);
      return;
    }

    case "vote": {
      const round = requireGuesser(c);
      const vote = a.vote === "approve" ? "approve" : a.vote === "reject" ? "reject" : null;
      if (!vote) throw new GameError(400, "Vote must be approve or reject");
      const p = await one<ProposalRow>(tx, "SELECT * FROM proposals WHERE id = ? AND round_id = ?", [
        String(a.proposalId),
        round.id,
      ]);
      if (!p) throw new GameError(404, "Proposal not found");
      if (p.status !== "pending") throw new GameError(409, "Voting on this proposal has closed");
      if (!(await castVote(c, p.id, c.me.id, vote))) throw new GameError(409, "You have already voted");
      await evaluateProposal(c, p.id);
      return;
    }

    case "offer_hint": {
      const round = requireChallenger(c);
      const category = text(a.category, "Hint category", 60);
      const hintText = multiline(a.text, "Hint text", 280);
      const cost = Number(a.cost);
      if (!Number.isInteger(cost) || cost < 1) throw new GameError(400, "Cost must be a positive whole number");
      const remaining = MAX_QUESTIONS - round.questions_consumed;
      if (cost > remaining) throw new GameError(400, `Cost cannot exceed the ${remaining} remaining questions`);
      if (await inflightProposal(tx, round.id)) {
        throw new GameError(409, "Resolve the current question or guess first");
      }
      const open = await one(tx, "SELECT 1 FROM proposals WHERE round_id = ? AND type = 'hint' AND status = 'pending'", [
        round.id,
      ]);
      if (open) throw new GameError(409, "You already have a hint offer awaiting a vote");
      const clientId = optionalClientId(a.clientId);
      const eligible = await guesserCount(tx, round.id);
      const proposalId = uid();
      await run(
        tx,
        `INSERT INTO proposals (id, round_id, proposed_by, type, content, question_cost, status, required_votes, eligible_voters, client_id, created_at)
         VALUES (?, ?, ?, 'hint', ?, ?, 'pending', ?, ?, ?, ?)`,
        [proposalId, round.id, c.me.id, category, cost, requiredVotes(eligible), eligible, clientId, t],
      );
      await run(
        tx,
        "INSERT INTO hints (id, proposal_id, round_id, category, restricted_hint_text, cost) VALUES (?, ?, ?, ?, ?, ?)",
        [uid(), proposalId, round.id, category, hintText, cost],
      );
      return;
    }

    case "withdraw_hint": {
      const round = requireChallenger(c);
      const ok = await run(
        tx,
        "UPDATE proposals SET status = 'cancelled', resolved_at = ? WHERE id = ? AND round_id = ? AND type = 'hint' AND status = 'pending'",
        [t, String(a.proposalId), round.id],
      );
      if (!ok) throw new GameError(409, "That hint offer is no longer open");
      return;
    }

    case "answer_question": {
      const round = requireChallenger(c);
      const answer: Answer | null = a.answer === "yes" || a.answer === "no" || a.answer === "unknown" ? a.answer : null;
      if (!answer) throw new GameError(400, "Answer must be yes, no or unknown");
      const p = await inflightProposal(tx, round.id);
      if (!p || p.type !== "question" || p.id !== a.proposalId) {
        throw new GameError(409, "There is no question waiting for an answer");
      }
      const ok = await run(tx, "UPDATE questions SET answer = ?, answered_at = ? WHERE proposal_id = ? AND answer IS NULL", [
        answer,
        t,
        p.id,
      ]);
      if (!ok) throw new GameError(409, "Already answered");
      await run(tx, "UPDATE proposals SET status = 'resolved', resolved_at = ? WHERE id = ? AND status = 'approved'", [
        t,
        p.id,
      ]);
      const fresh = await freshRound(tx, round.id);
      if (fresh.questions_consumed >= MAX_QUESTIONS) await finishRound(c, round.id, "challenger");
      return;
    }

    case "abort_round": {
      requireHost(c);
      if (!c.round || (c.round.status !== "active" && c.round.status !== "setup")) {
        throw new GameError(409, "No round to abort");
      }
      await run(tx, "UPDATE rounds SET status = 'aborted', ended_at = ? WHERE id = ?", [t, c.round.id]);
      await run(
        tx,
        "UPDATE proposals SET status = 'cancelled', resolved_at = ? WHERE round_id = ? AND status IN ('pending','approved')",
        [t, c.round.id],
      );
      await run(tx, "UPDATE rooms SET status = 'lobby' WHERE id = ?", [c.room.id]);
      return;
    }

    case "back_to_lobby": {
      requireHost(c);
      if (c.room.status !== "results") throw new GameError(409, "The round has not finished");
      await run(tx, "UPDATE rooms SET status = 'lobby' WHERE id = ?", [c.room.id]);
      return;
    }

    case "claim_host": {
      if (c.isHost) return;
      const host = c.room.host_id
        ? await one<PlayerRow>(tx, "SELECT * FROM players WHERE id = ?", [c.room.host_id])
        : undefined;
      if (host && t - host.last_seen < HOST_CLAIM_AFTER_MS) {
        throw new GameError(409, "The host is still connected");
      }
      await run(tx, "UPDATE rooms SET host_id = ? WHERE id = ?", [c.me.id, c.room.id]);
      return;
    }

    default:
      throw new GameError(400, "Unknown action");
  }
}

/* ------------------------------------------------------------------ view */

/**
 * Builds the role-filtered view of a room for one session. Secrets, private
 * chat, pending proposals and votes are only included for roles allowed to
 * see them — nothing restricted ever leaves the server for other roles.
 */
export async function getRoomView(sessionId: string, rawCode: string): Promise<RoomView> {
  const code = normalizeCode(rawCode);
  const db = await getDb();
  const roundSel = "(SELECT current_round_id FROM rooms WHERE invite_code = ?)";
  const rs = await db.batch(
    [
      { sql: "SELECT * FROM rooms WHERE invite_code = ?", args: [code] },
      {
        sql: "SELECT * FROM players WHERE room_id = (SELECT id FROM rooms WHERE invite_code = ?) ORDER BY joined_at",
        args: [code],
      },
      { sql: `SELECT * FROM rounds WHERE id = ${roundSel}`, args: [code] },
      { sql: `SELECT * FROM round_players WHERE round_id = ${roundSel}`, args: [code] },
      { sql: `SELECT * FROM round_secrets WHERE round_id = ${roundSel}`, args: [code] },
      {
        sql: `SELECT * FROM (SELECT * FROM messages WHERE round_id = ${roundSel} ORDER BY created_at DESC LIMIT ${CHAT_LIMIT}) ORDER BY created_at`,
        args: [code],
      },
      { sql: `SELECT * FROM proposals WHERE round_id = ${roundSel} ORDER BY created_at`, args: [code] },
      {
        sql: `SELECT v.* FROM votes v JOIN proposals p ON p.id = v.proposal_id WHERE p.round_id = ${roundSel} ORDER BY v.created_at`,
        args: [code],
      },
      { sql: `SELECT * FROM questions WHERE round_id = ${roundSel} ORDER BY asked_at`, args: [code] },
      { sql: `SELECT * FROM hints WHERE round_id = ${roundSel}`, args: [code] },
      { sql: `SELECT * FROM guesses WHERE round_id = ${roundSel} ORDER BY submitted_at`, args: [code] },
      {
        sql: `SELECT r.number, r.status, r.winner, r.questions_consumed, r.challenger_id, s.secret_name
                FROM rounds r LEFT JOIN round_secrets s ON s.round_id = r.id
               WHERE r.room_id = (SELECT id FROM rooms WHERE invite_code = ?) AND r.status IN ('finished','aborted')
               ORDER BY r.number DESC LIMIT 20`,
        args: [code],
      },
    ],
    "read",
  );
  const rows = <T>(i: number) => rs[i].rows as unknown as T[];

  const room = rows<RoomRow>(0)[0];
  if (!room) throw new GameError(404, "Room not found");
  const playerRows = rows<PlayerRow>(1);
  const t = now();
  const meRow = playerRows.find((p) => p.session_id === sessionId);
  const nameOf = new Map(playerRows.map((p) => [p.id, p.display_name]));

  const players: PlayerView[] = playerRows.map((p) => ({
    id: p.id,
    name: p.display_name,
    online: t - p.last_seen < ONLINE_WINDOW_MS || p.id === meRow?.id,
    isHost: p.id === room.host_id,
  }));

  const base: RoomView = {
    version: room.version,
    code: room.invite_code,
    status: room.status as RoomView["status"],
    hostId: room.host_id,
    me: meRow ? { id: meRow.id, name: meRow.display_name, isHost: meRow.id === room.host_id } : null,
    players,
    round: null,
    pastRounds: [],
    serverTime: t,
  };

  if (!meRow) {
    // Not a member: only expose what the join screen needs.
    return { ...base, players: players.map((p) => ({ ...p, online: false })), status: base.status };
  }

  // Heartbeat (throttled, does not bump the room version).
  if (t - meRow.last_seen > HEARTBEAT_THROTTLE_MS) {
    await db.execute({ sql: "UPDATE players SET last_seen = ? WHERE id = ?", args: [t, meRow.id] });
  }

  base.pastRounds = rows<{
    number: number;
    status: string;
    winner: string | null;
    questions_consumed: number;
    challenger_id: string;
    secret_name: string | null;
  }>(11).map(
    (r): PastRoundView => ({
      number: r.number,
      challengerId: r.challenger_id,
      status: r.status as PastRoundView["status"],
      winner: r.winner as PastRoundView["winner"],
      questionsConsumed: r.questions_consumed,
      challengerName: nameOf.get(r.challenger_id) ?? "Unknown",
      secret: r.status === "finished" ? r.secret_name : null,
    }),
  );

  const round = rows<RoundRow>(2)[0];
  if (!round) return base;

  const roundPlayers = rows<{ player_id: string; role: string }>(3);
  const guesserIds = roundPlayers.filter((r) => r.role === "guesser").map((r) => r.player_id);
  const myRole: RoundRole =
    round.challenger_id === meRow.id ? "challenger" : guesserIds.includes(meRow.id) ? "guesser" : "spectator";
  const ended = round.status === "finished" || round.status === "aborted";

  const proposals = rows<ProposalRow>(6);
  const votes = rows<{ proposal_id: string; player_id: string; vote: "approve" | "reject" }>(7);
  const questions = rows<{
    id: string;
    proposal_id: string;
    question: string;
    answer: Answer | null;
    asked_at: number;
  }>(8);
  const hints = rows<{
    id: string;
    proposal_id: string;
    category: string;
    restricted_hint_text: string;
    cost: number;
    revealed_at: number | null;
  }>(9);
  const guesses = rows<{
    id: string;
    proposal_id: string;
    guessed_name: string;
    is_correct: number | null;
    submitted_at: number;
  }>(10);
  const proposalById = new Map(proposals.map((p) => [p.id, p]));
  const proposer = (proposalId: string) => nameOf.get(proposalById.get(proposalId)?.proposed_by ?? "") ?? "Unknown";

  // Public history: submitted questions, revealed hints, Name Guesses.
  const history: HistoryItem[] = [];
  questions.forEach((q, i) =>
    history.push({
      kind: "question",
      id: q.id,
      number: i + 1,
      question: q.question,
      proposedBy: proposer(q.proposal_id),
      answer: q.answer,
      at: q.asked_at,
    }),
  );
  for (const h of hints) {
    if (h.revealed_at == null) continue;
    history.push({ kind: "hint", id: h.id, category: h.category, text: h.restricted_hint_text, cost: h.cost, at: h.revealed_at });
  }
  for (const g of guesses) {
    history.push({
      kind: "guess",
      id: g.id,
      name: g.guessed_name,
      proposedBy: proposer(g.proposal_id),
      correct: g.is_correct == null ? null : g.is_correct === 1,
      at: g.submitted_at,
    });
  }
  history.sort((a, b) => a.at - b.at);

  const inflightRow = proposals.find((p) => p.status === "approved" && p.type === "question");
  const inflight: InflightView | null = inflightRow
    ? {
        proposalId: inflightRow.id,
        type: inflightRow.type as InflightView["type"],
        content: inflightRow.content,
        proposedByName: nameOf.get(inflightRow.proposed_by) ?? "Unknown",
      }
    : null;

  const view: RoundView = {
    id: round.id,
    number: round.number,
    status: round.status as RoundView["status"],
    challengerId: round.challenger_id,
    challengerName: nameOf.get(round.challenger_id) ?? "Unknown",
    questionsConsumed: round.questions_consumed,
    maxQuestions: MAX_QUESTIONS,
    remaining: MAX_QUESTIONS - round.questions_consumed,
    winner: round.winner as RoundView["winner"],
    endedAt: round.ended_at ?? null,
    myRole,
    guesserIds,
    requiredVotes: requiredVotes(guesserIds.length),
    history,
    inflight,
  };

  const secret = rows<{ secret_name: string }>(4)[0]?.secret_name;
  if (secret && (myRole === "challenger" || round.status === "finished")) view.secret = secret;

  if (myRole === "guesser") {
    view.chat = rows<{ id: string; player_id: string; content: string; created_at: number }>(5).map(
      (m): ChatMessage => ({
        id: m.id,
        playerId: m.player_id,
        playerName: nameOf.get(m.player_id) ?? "Unknown",
        content: m.content,
        createdAt: m.created_at,
      }),
    );
    view.proposals = proposals.map((p): ProposalView => {
      const pv = votes.filter((v) => v.proposal_id === p.id);
      const approvals = pv.filter((v) => v.vote === "approve").length;
      const rejections = pv.length - approvals;
      return {
        id: p.id,
        type: p.type,
        content: p.content,
        cost: p.question_cost,
        status: p.status as ProposalView["status"],
        proposedById: p.proposed_by,
        proposedByName: nameOf.get(p.proposed_by) ?? "Unknown",
        requiredVotes: p.required_votes,
        eligibleVoters: p.eligible_voters,
        approvals,
        rejections,
        pendingVotes: Math.max(0, p.eligible_voters - pv.length),
        myVote: pv.find((v) => v.player_id === meRow.id)?.vote ?? null,
        votes: pv.map(
          (v): VoteView => ({ playerId: v.player_id, playerName: nameOf.get(v.player_id) ?? "Unknown", vote: v.vote }),
        ),
        createdAt: p.created_at,
        resolvedAt: p.resolved_at,
      };
    });
  }

  if (myRole === "challenger") {
    const hintByProposal = new Map(hints.map((h) => [h.proposal_id, h]));
    view.hintOffers = proposals
      .filter((p) => p.type === "hint")
      .map((p): HintOfferView => {
        const h = hintByProposal.get(p.id);
        return {
          id: p.id,
          category: p.content,
          text: h?.restricted_hint_text ?? "",
          cost: p.question_cost,
          status: p.status as HintOfferView["status"],
          createdAt: p.created_at,
        };
      });
  }

  if (ended && round.status === "aborted") view.inflight = null;
  return { ...base, round: view };
}
