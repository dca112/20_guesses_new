/**
 * Database schema for 20 Guesses (SQLite / libSQL / Turso).
 *
 * Integrity rules from the PRD are enforced by the database where possible:
 *  - one vote per (proposal, player)
 *  - one role per (round, player)
 *  - at most one approved-but-unresolved action per round (partial unique index)
 *  - question counter is always between 0 and 20
 */
export const MAX_QUESTIONS = 20;

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS rooms (
    id               TEXT PRIMARY KEY,
    invite_code      TEXT NOT NULL UNIQUE,
    host_id          TEXT,
    status           TEXT NOT NULL DEFAULT 'lobby'
                     CHECK (status IN ('lobby','setup','playing','results')),
    current_round_id TEXT,
    version          INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    id           TEXT PRIMARY KEY,
    room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    last_seen    INTEGER NOT NULL,
    joined_at    INTEGER NOT NULL,
    UNIQUE (room_id, session_id)
  )`,
  `CREATE INDEX IF NOT EXISTS players_room ON players(room_id)`,
  `CREATE TABLE IF NOT EXISTS rounds (
    id                 TEXT PRIMARY KEY,
    room_id            TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    number             INTEGER NOT NULL,
    challenger_id      TEXT NOT NULL REFERENCES players(id),
    status             TEXT NOT NULL DEFAULT 'setup'
                       CHECK (status IN ('setup','active','finished','aborted')),
    questions_consumed INTEGER NOT NULL DEFAULT 0
                       CHECK (questions_consumed BETWEEN 0 AND ${MAX_QUESTIONS}),
    winner             TEXT CHECK (winner IS NULL OR winner IN ('guessers','challenger')),
    created_at         INTEGER NOT NULL,
    started_at         INTEGER,
    ended_at           INTEGER,
    UNIQUE (room_id, number)
  )`,
  `CREATE TABLE IF NOT EXISTS round_players (
    round_id  TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    role      TEXT NOT NULL CHECK (role IN ('challenger','guesser')),
    PRIMARY KEY (round_id, player_id)
  )`,
  `CREATE TABLE IF NOT EXISTS round_secrets (
    round_id    TEXT PRIMARY KEY REFERENCES rounds(id) ON DELETE CASCADE,
    secret_name TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    round_id   TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    player_id  TEXT NOT NULL REFERENCES players(id),
    content    TEXT NOT NULL,
    client_id  TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (round_id, player_id, client_id)
  )`,
  `CREATE INDEX IF NOT EXISTS messages_round ON messages(round_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS proposals (
    id              TEXT PRIMARY KEY,
    round_id        TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    proposed_by     TEXT NOT NULL REFERENCES players(id),
    type            TEXT NOT NULL CHECK (type IN ('question','hint','final_guess')),
    content         TEXT NOT NULL,
    question_cost   INTEGER NOT NULL DEFAULT 1 CHECK (question_cost > 0),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','cancelled','resolved')),
    required_votes  INTEGER NOT NULL,
    eligible_voters INTEGER NOT NULL,
    client_id       TEXT,
    created_at      INTEGER NOT NULL,
    resolved_at     INTEGER,
    UNIQUE (round_id, proposed_by, client_id)
  )`,
  `CREATE INDEX IF NOT EXISTS proposals_round ON proposals(round_id, status)`,
  // At most one approved (in-flight, unresolved) action per round.
  `CREATE UNIQUE INDEX IF NOT EXISTS proposals_one_inflight
     ON proposals(round_id) WHERE status = 'approved'`,
  `CREATE TABLE IF NOT EXISTS votes (
    id          TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    player_id   TEXT NOT NULL REFERENCES players(id),
    vote        TEXT NOT NULL CHECK (vote IN ('approve','reject')),
    created_at  INTEGER NOT NULL,
    UNIQUE (proposal_id, player_id)
  )`,
  `CREATE TABLE IF NOT EXISTS questions (
    id          TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
    round_id    TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    answer      TEXT CHECK (answer IS NULL OR answer IN ('yes','no','unknown')),
    asked_at    INTEGER NOT NULL,
    answered_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS hints (
    id                    TEXT PRIMARY KEY,
    proposal_id           TEXT NOT NULL UNIQUE REFERENCES proposals(id),
    round_id              TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    category              TEXT NOT NULL,
    restricted_hint_text  TEXT NOT NULL,
    cost                  INTEGER NOT NULL CHECK (cost > 0),
    revealed_at           INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS guesses (
    id           TEXT PRIMARY KEY,
    proposal_id  TEXT NOT NULL UNIQUE REFERENCES proposals(id),
    round_id     TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    guessed_name TEXT NOT NULL,
    is_correct   INTEGER CHECK (is_correct IS NULL OR is_correct IN (0,1)),
    submitted_at INTEGER NOT NULL,
    resolved_at  INTEGER
  )`,
];
