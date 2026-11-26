# Product Requirements Document — 20 Guesses

**Version:** 1.0 (MVP)  
**Platform:** Mobile-first multiplayer web application

## 1. Product overview

20 Guesses is a collaborative multiplayer game in which one player (the Challenger) secretly selects a person and the remaining players (Guessers) work together to identify that person within a shared budget of 20 questions. Guessers discuss privately, propose binary questions, vote on proposals, purchase hints using their question budget, and collectively submit final guesses.

## 2. Goals and scope

- Allow friends to join a game immediately through a shareable link, without registration.
- Encourage team discussion and democratic decision-making.
- Maintain a synchronized game state and a fair shared question budget.
- Support multiple rounds without requiring a new room.

Public matchmaking, leaderboards, AI-generated answers, accounts, and timed voting are outside the MVP scope.

## 3. Roles

| Role | Responsibilities |
|---|---|
| Host | Creates a room, shares the link, selects the Challenger and starts rounds. Can also play. |
| Challenger | Secretly enters a person's name, answers approved questions, offers hints and validates final guesses. Cannot see private team chat or pending votes. |
| Guesser | Discusses, proposes questions and final guesses, and votes on proposals and hints. |

The host receives no special voting privileges. The Challenger cannot vote.

## 4. Core game flow

1. Host creates a room and shares its unique invite link.
2. Players join using a display name; the lobby shows participants.
3. Host selects a Challenger, who privately enters the secret person's name.
4. Challenger starts the round with 0 of 20 questions consumed.
5. Guessers discuss privately and propose questions or final guesses.
6. Guessers vote. A strict majority automatically approves an action.
7. An approved question is sent to the Challenger, who answers Yes or No (Unknown is available when necessary).
8. Challenger may offer hints at a specified question cost; the team votes before the hint is revealed.
9. Repeat until the team correctly identifies the person or exhausts its budget.
10. Show results, reveal the answer, and allow the host to start another round with a different Challenger.

## 5. Game mechanics

### 5.1 Private team chat

- Unlimited real-time text chat visible exclusively to Guessers.
- Ordinary messages do not consume the question budget.
- Challenger must not receive chat data, including through API or real-time subscriptions.

### 5.2 Propose a question

- Any Guesser can select **Propose Question** and enter a statement or question answerable with Yes or No (e.g., “Is the person male?” or “Is the person associated with sports?”).
- Proposals appear in the private team area with the author, vote counts and voting controls.
- Proposing a question is free. The proposer automatically votes Approve.
- Multiple pending proposals may coexist; only one approved action may be resolved at a time.
- Once approved, a question is automatically submitted to the Challenger and consumes one question.
- The Challenger answers Yes, No, or Unknown. Unknown still consumes the question.
- Other pending proposals are cancelled when an action is approved; players may propose them again after resolution.
- Rejected or cancelled proposals consume no questions.

### 5.3 Voting rules

Every eligible Guesser has one vote per proposal: **Approve** or **Reject**. Votes are final for that proposal. Approval requires a strict majority of eligible Guessers, including the proposer where applicable.

`required_votes = floor(number_of_eligible_guessers / 2) + 1`

| Guessers | Approvals required |
|---:|---:|
| 1 | 1 |
| 2 | 2 |
| 3 | 2 |
| 4 | 3 |
| 5 | 3 |
| 6 | 4 |
| 7 | 4 |
| 8 | 5 |

- A proposal is rejected when enough Reject votes make approval mathematically impossible, including a tied final vote.
- Eligible voters are the round's Guessers. Reconnection does not create another vote. New participants wait until the next round.
- If a disconnected player prevents progress, the host may abort the round and return to the lobby. No voting timer is required for MVP.
- Vote counts and outcomes update in real time.
- The Challenger cannot see pending question or final-guess proposals or voting activity.

### 5.4 Hint offers

The Challenger can offer a hint with a category, private hint text and positive integer question cost. Only the category and cost are visible before approval. Hint offers require the same strict majority of Guessers, but have no automatic proposer approval because the Challenger cannot vote.

Example:

- Current questions consumed: 3 of 20.
- Hint category: geographical location.
- Cost: 3 questions.
- After majority approval: reveal “The person is from India” and increase consumed questions from 3 to 6.
- Remaining questions: 14.

Rejected hints are not revealed and do not consume questions. The cost cannot exceed the remaining budget. Hint content and cost cannot be changed after voting starts; a replacement requires a new offer and fresh votes.

### 5.5 Final guesses

- Any Guesser can select **Guess Person** and propose a name.
- The proposal follows the same majority voting rules as ordinary questions.
- Once approved, the Challenger confirms whether the name identifies the secret person (allowing spelling variations and aliases).
- A correct guess immediately wins the round. An incorrect guess consumes one question.
- At least one remaining question is required to submit a final guess.

### 5.6 Budget and round outcomes

| Action | Vote required? | Questions consumed |
|---|---|---:|
| Private chat | No | 0 |
| Propose question or guess | No | 0 |
| Approved binary question | Yes | 1 |
| Approved hint | Yes | Challenger-defined cost |
| Approved incorrect final guess | Yes | 1 |
| Approved correct final guess | Yes | 0 (wins round) |
| Rejected or cancelled proposal | No further vote | 0 |

Guessers win by correctly identifying the person. Challenger wins when 20 questions have been consumed without a correct guess. An already-submitted question must be answered before the round is closed. No new action can be submitted once the budget is exhausted. All pending proposals are closed at round end.

## 6. Required screens

| Screen | Components |
|---|---|
| Landing page | Create game, join game. |
| Lobby | Invite link, participant list, Challenger selection, start round. |
| Challenger setup | Secret name input and start control. |
| Guesser dashboard | Shared counter, private chat, question history, proposed questions, approve/reject buttons, hint offers, propose question and guess person buttons. |
| Challenger dashboard | Secret name, shared counter, approved questions, Yes/No/Unknown buttons, final-guess validation, hint offer form. |
| Results | Winner, secret person, question count, history and next-round control. |

### Example Guesser dashboard

```text
20 Guesses — Round 1                 3 / 20 used
Challenger: Vikram                   17 remaining

QUESTION HISTORY
Is the person male?                  Yes
Is the person alive?                 Yes
Is the person an actor?              No

PRIVATE TEAM CHAT
Rahul: Could it be a sportsperson?
Neha: Let's confirm nationality first.
[ Type a message... ] [Send]

PROPOSED QUESTION — Rahul
Is the person associated with sports?
2 Approve | 0 Reject | 3 Pending
[Approve] [Reject]       3 of 5 required

HINT OFFER — Geographical location
Cost: 3 questions (counter becomes 6/20)
[Accept hint] [Reject hint]

[Propose Question]       [Guess Person]
```

## 7. Feature priorities

All of the following are P0 (required for MVP): room creation and link-based joining, anonymous sessions, Challenger selection, secret answer, real-time private chat, question proposals, majority voting, automatic submission, binary answers, question counter, paid hint offers and voting, final-guess proposals and voting, results, reconnection, and next-round support.

P2 / future: leaderboards, timed rounds, public matchmaking, categories beyond people, and AI assistance.

## 8. Suggested technical architecture

| Component | Technology |
|---|---|
| Frontend | Next.js, React, Tailwind CSS |
| Backend | Next.js API routes / server-side actions |
| Database | Supabase PostgreSQL |
| Real-time communication | Supabase Realtime |
| Identity | Anonymous authenticated sessions |
| Hosting | Vercel |

No AI integration is required. The server is authoritative for voting, access control, counters and round outcomes. Use database transactions and constraints for concurrency protection. Keep secrets in restricted tables or server-only storage, not in public real-time payloads.

## 9. Suggested data model

| Entity | Key fields |
|---|---|
| rooms | id, invite_code, host_id, status |
| players | id, room_id, display_name, session_id, connection_status |
| rounds | id, room_id, challenger_id, status, questions_consumed, winner |
| round_players | round_id, player_id, role |
| round_secrets | round_id, secret_name (restricted) |
| messages | id, round_id, player_id, content, created_at |
| proposals | id, round_id, proposed_by, type (question/hint/final_guess), content, question_cost, status, required_votes, created_at |
| votes | id, proposal_id, player_id, vote, created_at |
| questions | id, proposal_id, round_id, question, answer, answered_at |
| hints | id, proposal_id, round_id, category, restricted_hint_text, cost, revealed_at |
| guesses | id, proposal_id, round_id, guessed_name, is_correct |

Constraints: unique `(proposal_id, player_id)` on votes; unique `(round_id, player_id)` on round_players; at most one unresolved approved action per round. Enforce a question counter between 0 and 20. Apply atomic approval and budget updates, and idempotent requests to prevent duplicate execution.

## 10. Acceptance criteria

- Players can create and join a room through a unique link without registering.
- The host can select a Challenger and start a round.
- Refreshing or reconnecting restores the existing identity and round state.
- Only Guessers can access private team chat, pending question/guess proposals and votes.
- Guessers cannot access the secret answer or unaccepted hint text.
- All participants see role-appropriate updates in real time.
- A proposer automatically votes in favour of their question or final guess.
- Each eligible Guesser can vote only once per proposal.
- Strict majority approval automatically submits exactly one action.
- Concurrent votes and approvals cannot double-submit actions or consume the budget twice.
- Rejected and cancelled proposals consume no questions.
- Accepting a hint reveals it exactly once and deducts its stated cost exactly once.
- An action exceeding the remaining budget is rejected server-side.
- Correct final guesses end the round; incorrect guesses consume one question.
- Exhausting the question budget ends the round after any in-flight action is resolved.
- All pending proposals are closed at round end.
- Results reveal the secret name, winner and question count.
- The host can start a new round without creating a new room.

## 11. Assumptions and design decisions

- The limit is 20 total consumed questions, not 20 actual binary questions plus hints.
- Strict majority voting is mandatory for questions, hints and final guesses in the first release.
- Incorrect final guesses cost one question; correct guesses are free and end the game.
- Unknown answers are permitted as an exception to binary answers and still consume a question.
- There is no voting timer. A host can abort a stalled round rather than override a vote.
- Round membership is fixed to avoid changing voting thresholds mid-round.
- Next-round support is included in MVP for convenience (an expansion from the initial P1 suggestion).
- The proposed technical stack is a recommendation, not a hard product requirement.
