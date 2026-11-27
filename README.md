# 20 Guesses

A collaborative, mobile-first multiplayer guessing game. One player (the Challenger) secretly picks a person; everyone else (the Guessers) discusses privately, proposes yes/no questions, votes, buys hints and makes Name Guesses, all from a shared budget of 20 questions.

The product spec is in [`20-guesses-prd.md`](./20-guesses-prd.md).

## Stack

| Layer | Technology |
|---|---|
| UI | React 19 + Next.js 16 (App Router), Tailwind CSS 4 |
| Backend | Next.js route handlers (Node.js runtime) |
| Database | [Turso](https://turso.tech) (libSQL) via `@libsql/client`; a local SQLite file in development |
| Real-time | Short polling of a role-filtered state endpoint (about 1.5 s; slower when the tab is hidden) |
| Identity | Anonymous session ID in an httpOnly cookie, so no registration is needed |

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000, uses ./local.db automatically
```

### Using Turso

```bash
turso db create twenty-guesses
turso db show twenty-guesses --url        # -> TURSO_DATABASE_URL
turso db tokens create twenty-guesses     # -> TURSO_AUTH_TOKEN
cp .env.example .env.local                # fill in both values
npm run db:migrate                        # optional: the schema is also applied on first request
```

Deploy to Vercel (or any Node host) with the same two environment variables.

### Troubleshooting

**`ConnectionFailed("Unable to open connection to local database local.db: 14")`**: the app didn't find `TURSO_DATABASE_URL`, so it tried to create a local SQLite file, and the host wouldn't allow it. Serverless hosts like Vercel have a read-only filesystem.
- **On Vercel:** go to Project → Settings → Environment Variables. Add `TURSO_DATABASE_URL` (`libsql://…`) and `TURSO_AUTH_TOKEN` for the environment you deploy (Production and/or Preview), then **redeploy**. Variables only apply to new deployments.
- **Running locally:** put the values in `.env.local` in the project root, not `.env.example`. You can also leave them unset and run from a folder you can write to.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development server, production build and production server |
| `npm test` | Game-engine tests (voting, budget, hints, visibility, concurrency) against a real libSQL database |
| `npm run test:e2e` | HTTP end-to-end run against a running server (`BASE_URL`, default `http://localhost:3000`) |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Apply the schema to `TURSO_DATABASE_URL` |

## Architecture

```
app/
  page.tsx                         Landing page: create or join a game
  room/[code]/page.tsx             Room shell, which renders components/RoomClient
  api/rooms/route.ts               POST create room
  api/rooms/[code]/join/route.ts   POST join or reconnect
  api/rooms/[code]/state/route.ts  GET role-filtered state (polled)
  api/rooms/[code]/action/route.ts POST every game action
lib/
  schema.ts    Tables, constraints and indexes
  db.ts        Turso client, migrations, serialised write transactions with retry
  game.ts      Server-authoritative game engine and role-filtered views
  session.ts   Anonymous cookie session
  types.ts     Types shared by the client and server
components/    Lobby, Setup, GuesserDashboard, ChallengerDashboard, Results, SpectatorView
```

### How the PRD rules are enforced

- **The server decides everything.** Clients send intents such as `propose`, `vote`, `offer_hint` and `answer_question`. Each one runs in a single `BEGIN IMMEDIATE` transaction that re-reads the current state first.
- **Role-filtered views.** `getRoomView` builds a separate payload for each role:
  - The secret, private chat, pending proposals, votes and unaccepted hint text are left out for roles that may not see them. They are never sent to the browser.
  - The Challenger gets their own hint offers, but no voting activity.
  - Players who join mid-round watch as spectators until the next round.
- **Voting.** Approval needs `floor(guessers / 2) + 1` approvals. The proposer's Approve vote is cast automatically; hints get no automatic vote. A proposal is rejected as soon as approval becomes mathematically impossible, which includes a tied final vote.
- **Concurrency and idempotency.** These protections are built into the database:
  - `UNIQUE(proposal_id, player_id)` on votes.
  - A partial unique index allows only one approved, unresolved action per round.
  - `CHECK (questions_consumed BETWEEN 0 AND 20)` bounds the counter.
  - Conditional updates (`WHERE status = 'pending'`, `WHERE answer IS NULL`) and `clientId` de-duplication mean a repeated or concurrent request cannot run an action twice or charge the budget twice.
- **Name Guesses.** A Guesser turns on the *Name Guess* toggle when proposing. It's voted on like a regular question. Once approved, the server compares the name to the secret (case-insensitive, ignoring leading and trailing spaces) with no Challenger input. Every approved Name Guess costs 1 question:
  - **Correct:** the team wins at once, even if it used the 20th question.
  - **Incorrect:** every screen shows "Incorrect guess" and the game continues.
- **Budget.**
  - An approved question costs 1 as soon as it is submitted.
  - An approved hint costs its stated price and is revealed once.
  - Any action that would exceed the remaining budget is rejected on the server.
  - A round ends normally in only two ways: a correct Name Guess (the Guessing Team wins), or all 20 questions used (the Challenger wins). If the last question is still waiting for an answer, the round ends once it's answered. Every pending proposal is closed when a round ends.
- **Winner celebration.** Every participant, including the Challenger, sees it automatically once per round:
  - a full-screen overlay with confetti ([canvas-confetti](https://www.npmjs.com/package/canvas-confetti));
  - recorded crowd applause played with [Howler.js](https://howlerjs.com);
  - "Guessing Team Wins!" or "Challenger Wins!", the secret name and the total questions used (including hints);
  - a **Play Again** button.

  To make it appear on every screen at once, clients start it at the same moment on the server's clock: round end + 2 s. Until then each screen shows a short drumroll, so nobody sees the result early. Sound credit: [`public/sounds/CREDITS.md`](public/sounds/CREDITS.md).
- **Rounds.**
  - The guessers are fixed when a round starts.
  - The host can abort a stalled round. If the host has been offline for 60 seconds, another player can take over as host.
  - The host starts each new round from the lobby, in the same room.

### Why polling?

Turso doesn't push changes to clients. Short polling works the same way on serverless hosts such as Vercel and needs no extra infrastructure. Each poll is a single batched read, so it costs one database round trip. To move to push updates later, put an SSE or WebSocket layer in front of `getRoomView`; the rest of the app stays the same.
