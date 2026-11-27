/** Types shared between the server (role-filtered views) and the client. */

export type RoomStatus = "lobby" | "setup" | "playing" | "results";
export type RoundStatus = "setup" | "active" | "finished" | "aborted";
export type RoundRole = "challenger" | "guesser" | "spectator";
export type ProposalType = "question" | "hint" | "final_guess";
export type ProposalStatus = "pending" | "approved" | "rejected" | "cancelled" | "resolved";
export type Answer = "yes" | "no" | "unknown";
export type Winner = "guessers" | "challenger";

export interface PlayerView {
  id: string;
  name: string;
  online: boolean;
  isHost: boolean;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  content: string;
  createdAt: number;
}

export type HistoryItem =
  | {
      kind: "question";
      id: string;
      number: number;
      question: string;
      proposedBy: string;
      answer: Answer | null;
      at: number;
    }
  | {
      kind: "hint";
      id: string;
      category: string;
      text: string;
      cost: number;
      at: number;
    }
  | {
      kind: "guess";
      id: string;
      name: string;
      proposedBy: string;
      correct: boolean | null;
      at: number;
    };

export interface VoteView {
  playerId: string;
  playerName: string;
  vote: "approve" | "reject";
}

/** A proposal as seen by Guessers (never sent to the Challenger). */
export interface ProposalView {
  id: string;
  type: ProposalType;
  /** Question text, guessed name, or hint category. */
  content: string;
  cost: number;
  status: ProposalStatus;
  proposedById: string;
  proposedByName: string;
  requiredVotes: number;
  eligibleVoters: number;
  approvals: number;
  rejections: number;
  pendingVotes: number;
  myVote: "approve" | "reject" | null;
  votes: VoteView[];
  createdAt: number;
  resolvedAt: number | null;
}

/** A hint offer as seen by the Challenger who made it (no voting activity). */
export interface HintOfferView {
  id: string;
  category: string;
  text: string;
  cost: number;
  status: ProposalStatus;
  createdAt: number;
}

export interface InflightView {
  proposalId: string;
  type: "question";
  content: string;
  proposedByName: string;
}

export interface RoundView {
  id: string;
  number: number;
  status: RoundStatus;
  challengerId: string;
  challengerName: string;
  questionsConsumed: number;
  maxQuestions: number;
  remaining: number;
  winner: Winner | null;
  /** Server timestamp (ms) when the round ended; null while in progress. */
  endedAt: number | null;
  myRole: RoundRole;
  guesserIds: string[];
  requiredVotes: number;
  history: HistoryItem[];
  inflight: InflightView | null;
  /** Challenger always; everyone once the round has finished. */
  secret?: string;
  /** Guessers only. */
  chat?: ChatMessage[];
  /** Guessers only. */
  proposals?: ProposalView[];
  /** Challenger only. */
  hintOffers?: HintOfferView[];
}

export interface PastRoundView {
  number: number;
  challengerId: string;
  challengerName: string;
  status: RoundStatus;
  winner: Winner | null;
  questionsConsumed: number;
  secret: string | null;
}

export interface RoomView {
  version: number;
  code: string;
  status: RoomStatus;
  hostId: string | null;
  me: { id: string; name: string; isHost: boolean } | null;
  players: PlayerView[];
  round: RoundView | null;
  pastRounds: PastRoundView[];
  serverTime: number;
}

export type GameAction =
  | { type: "select_challenger"; playerId: string }
  | { type: "cancel_setup" }
  | { type: "start_round"; secretName: string }
  | { type: "send_message"; content: string; clientId?: string }
  /** kind "final_guess" (alias "name_guess") is a Name Guess, auto-checked against the secret. */
  | { type: "propose"; kind: "question" | "final_guess" | "name_guess"; content: string; clientId?: string }
  | { type: "vote"; proposalId: string; vote: "approve" | "reject" }
  | { type: "offer_hint"; category: string; text: string; cost: number; clientId?: string }
  | { type: "withdraw_hint"; proposalId: string }
  | { type: "answer_question"; proposalId: string; answer: Answer }
  | { type: "abort_round" }
  | { type: "back_to_lobby" }
  | { type: "claim_host" };
