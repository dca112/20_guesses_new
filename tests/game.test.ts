import { createClient, type Client } from "@libsql/client";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { setDbForTests } from "../lib/db";
import { createRoom, GameError, getRoomView, joinRoom, namesMatch, performAction, requiredVotes } from "../lib/game";
import type { GameAction, ProposalView } from "../lib/types";

let dir: string;
let client: Client;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "tg-test-"));
});
after(() => {
  client?.close();
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
beforeEach(() => {
  client?.close();
  client = createClient({ url: `file:${join(dir, `t${n++}.db`)}` });
  setDbForTests(client);
});

const act = (sid: string, code: string, a: GameAction) => performAction(sid, code, a);
const view = (sid: string, code: string) => getRoomView(sid, code);

async function expectError(p: Promise<unknown>, status: number, re?: RegExp) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof GameError, `expected GameError, got ${err}`);
    assert.equal(err.status, status, err.message);
    if (re) assert.match(err.message, re);
    return true;
  });
}

/** Host "h" + players; "c" becomes the Challenger; the rest are Guessers. */
async function setup(guessers = ["h", "g1", "g2"]) {
  const { code } = await createRoom("h", "Host");
  for (const g of guessers.filter((x) => x !== "h")) await joinRoom(g, code, g.toUpperCase());
  await joinRoom("c", code, "Challenger");
  const cId = (await view("c", code)).me!.id;
  await act("h", code, { type: "select_challenger", playerId: cId });
  await act("c", code, { type: "start_round", secretName: "Sachin Tendulkar" });
  return code;
}

async function pendingOf(sid: string, code: string): Promise<ProposalView[]> {
  return ((await view(sid, code)).round!.proposals ?? []).filter((p) => p.status === "pending");
}

async function consumed(code: string) {
  return (await view("c", code)).round!.questionsConsumed;
}

describe("voting thresholds", () => {
  it("matches the PRD table", () => {
    const table = [1, 2, 2, 3, 3, 4, 4, 5];
    table.forEach((req, i) => assert.equal(requiredVotes(i + 1), req));
  });
});

describe("rooms and sessions", () => {
  it("rejoining with the same session restores the same identity", async () => {
    const { code } = await createRoom("h", "Host");
    const a = await joinRoom("p", code, "Pat");
    const b = await joinRoom("p", code, "");
    assert.equal(a.playerId, b.playerId);
    assert.equal((await view("h", code)).players.length, 2);
  });

  it("non-members get no round data", async () => {
    const code = await setup();
    const v = await view("stranger", code);
    assert.equal(v.me, null);
    assert.equal(v.round, null);
  });

  it("requires two players to start", async () => {
    const { code } = await createRoom("h", "Host");
    const hId = (await view("h", code)).me!.id;
    await expectError(act("h", code, { type: "select_challenger", playerId: hId }), 409);
  });

  it("only the host selects the Challenger", async () => {
    const { code } = await createRoom("h", "Host");
    await joinRoom("p", code, "Pat");
    const pId = (await view("p", code)).me!.id;
    await expectError(act("p", code, { type: "select_challenger", playerId: pId }), 403);
  });
});

describe("role-based visibility", () => {
  it("hides secret from Guessers and chat/proposals from the Challenger", async () => {
    const code = await setup();
    await act("g1", code, { type: "send_message", content: "hello team" });
    await act("g1", code, { type: "propose", kind: "question", content: "Is the person male?" });

    const g = (await view("g1", code)).round!;
    assert.equal(g.myRole, "guesser");
    assert.equal(g.secret, undefined);
    assert.equal(g.chat!.length, 1);
    assert.equal(g.proposals!.length, 1);

    const c = (await view("c", code)).round!;
    assert.equal(c.myRole, "challenger");
    assert.equal(c.secret, "Sachin Tendulkar");
    assert.equal(c.chat, undefined);
    assert.equal(c.proposals, undefined);
    assert.ok(!JSON.stringify(c).includes("hello team"));
    assert.ok(!JSON.stringify(c).includes("Is the person male?"));
  });

  it("the Challenger cannot chat, propose or vote", async () => {
    const code = await setup();
    await expectError(act("c", code, { type: "send_message", content: "hi" }), 403);
    await expectError(act("c", code, { type: "propose", kind: "question", content: "x?" }), 403);
  });

  it("players joining mid-round are spectators", async () => {
    const code = await setup();
    await joinRoom("late", code, "Late");
    const v = (await view("late", code)).round!;
    assert.equal(v.myRole, "spectator");
    assert.equal(v.chat, undefined);
    assert.equal(v.secret, undefined);
    await expectError(act("late", code, { type: "send_message", content: "hi" }), 403);
    // Threshold is unchanged: still 3 guessers.
    assert.equal(v.requiredVotes, 2);
  });
});

describe("questions", () => {
  it("proposer auto-approves; majority submits exactly one question", async () => {
    const code = await setup(); // 3 guessers → 2 required
    await act("g1", code, { type: "propose", kind: "question", content: "Is the person male?" });
    await act("g2", code, { type: "propose", kind: "question", content: "Is the person alive?" });
    let pending = await pendingOf("h", code);
    assert.equal(pending.length, 2);
    assert.equal(pending[0].approvals, 1);
    assert.equal(pending[0].requiredVotes, 2);

    await act("h", code, { type: "vote", proposalId: pending[0].id, vote: "approve" });
    pending = await pendingOf("h", code);
    assert.equal(pending.length, 0, "other pending proposals are cancelled");
    const all = (await view("h", code)).round!.proposals!;
    assert.equal(all.find((p) => p.content === "Is the person alive?")!.status, "cancelled");
    assert.equal(await consumed(code), 1);

    const c = (await view("c", code)).round!;
    assert.equal(c.inflight?.content, "Is the person male?");
    // Nothing new can be proposed while waiting.
    await expectError(act("g2", code, { type: "propose", kind: "question", content: "Q?" }), 409);

    await act("c", code, { type: "answer_question", proposalId: c.inflight!.proposalId, answer: "yes" });
    await expectError(
      act("c", code, { type: "answer_question", proposalId: c.inflight!.proposalId, answer: "no" }),
      409,
    );
    const after = (await view("g1", code)).round!;
    assert.equal(after.inflight, null);
    assert.equal(after.history[0].kind, "question");
    assert.equal(after.history[0].kind === "question" && after.history[0].answer, "yes");
    assert.equal(after.questionsConsumed, 1);
  });

  it("rejects when approval becomes impossible and consumes nothing", async () => {
    const code = await setup(["h", "g1", "g2", "g3"]); // 4 guessers → 3 required
    await act("g1", code, { type: "propose", kind: "question", content: "Q?" });
    const [p] = await pendingOf("g1", code);
    await act("g2", code, { type: "vote", proposalId: p.id, vote: "reject" });
    assert.equal((await pendingOf("g1", code)).length, 1, "still possible: 1 approve, 1 reject, 2 outstanding");
    await act("g3", code, { type: "vote", proposalId: p.id, vote: "reject" });
    const all = (await view("g1", code)).round!.proposals!;
    assert.equal(all[0].status, "rejected");
    assert.equal(await consumed(code), 0);
  });

  it("a tied final vote rejects", async () => {
    const code = await setup(["h", "g1"]); // 2 guessers → 2 required
    await act("g1", code, { type: "propose", kind: "question", content: "Q?" });
    const [p] = await pendingOf("g1", code);
    await act("h", code, { type: "vote", proposalId: p.id, vote: "reject" });
    assert.equal((await view("g1", code)).round!.proposals![0].status, "rejected");
  });

  it("a single Guesser's proposal is approved immediately", async () => {
    const code = await setup(["h"]);
    await act("h", code, { type: "propose", kind: "question", content: "Q?" });
    assert.equal(await consumed(code), 1);
  });

  it("each Guesser votes only once", async () => {
    const code = await setup(["h", "g1", "g2", "g3", "g4"]);
    await act("g1", code, { type: "propose", kind: "question", content: "Q?" });
    const [p] = await pendingOf("g1", code);
    await expectError(act("g1", code, { type: "vote", proposalId: p.id, vote: "approve" }), 409);
    await act("g2", code, { type: "vote", proposalId: p.id, vote: "reject" });
    await expectError(act("g2", code, { type: "vote", proposalId: p.id, vote: "approve" }), 409);
  });

  it("concurrent approvals submit exactly once", async () => {
    const code = await setup(["h", "g1", "g2", "g3", "g4", "g5", "g6"]); // 7 guessers → 4 required
    await act("g1", code, { type: "propose", kind: "question", content: "Q?" });
    const [p] = await pendingOf("g1", code);
    const results = await Promise.allSettled(
      ["h", "g2", "g3", "g4", "g5", "g6"].map((s) => act(s, code, { type: "vote", proposalId: p.id, vote: "approve" })),
    );
    assert.ok(results.filter((r) => r.status === "fulfilled").length >= 3);
    assert.equal(await consumed(code), 1);
    const qs = await client.execute("SELECT COUNT(*) AS n FROM questions");
    assert.equal(qs.rows[0].n, 1);
  });

  it("idempotent proposal retries with the same clientId", async () => {
    const code = await setup();
    const a: GameAction = { type: "propose", kind: "question", content: "Q?", clientId: "abc" };
    await Promise.all([act("g1", code, a), act("g1", code, a)]).catch(() => undefined);
    await act("g1", code, a);
    assert.equal((await pendingOf("g1", code)).length, 1);
  });
});

describe("hints", () => {
  it("reveals once and deducts the cost exactly once", async () => {
    const code = await setup();
    await act("c", code, { type: "offer_hint", category: "Geographical location", text: "The person is from India", cost: 3 });
    const g = await view("g1", code);
    assert.ok(!JSON.stringify(g).includes("from India"), "hint text hidden before approval");
    const [hint] = (g.round!.proposals ?? []).filter((p) => p.type === "hint");
    assert.equal(hint.content, "Geographical location");
    assert.equal(hint.cost, 3);
    assert.equal(hint.approvals, 0, "no automatic approval for hints");

    await Promise.allSettled(
      ["h", "g1", "g2"].map((s) => act(s, code, { type: "vote", proposalId: hint.id, vote: "approve" })),
    );
    const after = (await view("g2", code)).round!;
    assert.equal(after.questionsConsumed, 3);
    assert.equal(after.remaining, 17);
    const revealed = after.history.filter((h) => h.kind === "hint");
    assert.equal(revealed.length, 1);
    assert.equal(revealed[0].kind === "hint" && revealed[0].text, "The person is from India");
  });

  it("rejected hints are not revealed and cost nothing", async () => {
    const code = await setup();
    await act("c", code, { type: "offer_hint", category: "Era", text: "Born in 1973", cost: 2 });
    const [hint] = await pendingOf("g1", code);
    await act("g1", code, { type: "vote", proposalId: hint.id, vote: "reject" });
    await act("g2", code, { type: "vote", proposalId: hint.id, vote: "reject" });
    const v = await view("g1", code);
    assert.equal(v.round!.questionsConsumed, 0);
    assert.ok(!JSON.stringify(v).includes("1973"));
  });

  it("cost cannot exceed the remaining budget", async () => {
    const code = await setup();
    await client.execute("UPDATE rounds SET questions_consumed = 18");
    await expectError(act("c", code, { type: "offer_hint", category: "Era", text: "x", cost: 3 }), 400);
    await expectError(act("c", code, { type: "offer_hint", category: "Era", text: "x", cost: 0 }), 400);
  });

  it("an approval that would exceed the budget is rejected server-side", async () => {
    const code = await setup();
    await act("c", code, { type: "offer_hint", category: "Era", text: "x", cost: 3 });
    await client.execute("UPDATE rounds SET questions_consumed = 18"); // budget shrank since the offer
    const [hint] = await pendingOf("g1", code);
    await act("g1", code, { type: "vote", proposalId: hint.id, vote: "approve" });
    await act("g2", code, { type: "vote", proposalId: hint.id, vote: "approve" });
    const v = (await view("g1", code)).round!;
    assert.equal(v.questionsConsumed, 18);
    assert.equal(v.proposals![0].status, "rejected");
  });
});

describe("name guesses and round end", () => {
  async function approveNameGuess(code: string, name: string, proposer = "g1", voter = "h") {
    await act(proposer, code, { type: "propose", kind: "name_guess", content: name });
    const p = (await pendingOf(proposer, code)).find((x) => x.type === "final_guess");
    if (p) await act(voter, code, { type: "vote", proposalId: p.id, vote: "approve" });
  }

  it("matches names case-insensitively, ignoring leading/trailing spaces", () => {
    assert.ok(namesMatch("  sachin TENDULKAR ", "Sachin Tendulkar"));
    assert.ok(!namesMatch("Sachin", "Sachin Tendulkar"));
  });

  it("a Name Guess needs a majority like any question", async () => {
    const code = await setup(); // 3 guessers → 2 required
    await act("g1", code, { type: "propose", kind: "name_guess", content: "Sachin Tendulkar" });
    let v = await view("g1", code);
    assert.equal(v.status, "playing", "one approval is not enough");
    const [p] = await pendingOf("g1", code);
    await act("g2", code, { type: "vote", proposalId: p.id, vote: "reject" });
    await act("h", code, { type: "vote", proposalId: p.id, vote: "reject" });
    v = await view("g1", code);
    assert.equal(v.status, "playing");
    assert.equal(v.round!.questionsConsumed, 0, "rejected guesses cost nothing");
  });

  it("an incorrect Name Guess costs one question and the game continues", async () => {
    const code = await setup(["h", "g1"]);
    await approveNameGuess(code, "Virat Kohli");
    const v = await view("c", code);
    assert.equal(v.status, "playing");
    assert.equal(v.round!.questionsConsumed, 1);
    assert.equal(v.round!.inflight, null, "no Challenger action needed");
    const g = v.round!.history.find((h) => h.kind === "guess");
    assert.ok(g && g.kind === "guess" && g.correct === false);
  });

  it("a correct Name Guess is checked automatically, costs one question, wins and closes pending proposals", async () => {
    const code = await setup(["h", "g1"]);
    await act("c", code, { type: "offer_hint", category: "Era", text: "1990s", cost: 1 });
    await approveNameGuess(code, "  sachin tendulkar ");
    for (const sid of ["c", "h", "g1"]) {
      const v = await view(sid, code);
      assert.equal(v.status, "results", `${sid} sees results`);
      assert.equal(v.round!.winner, "guessers");
      assert.equal(v.round!.secret, "Sachin Tendulkar", "correct name shown to everyone");
      assert.equal(v.round!.questionsConsumed, 1);
      assert.ok(v.round!.endedAt);
    }
    const g = (await view("g1", code)).round!;
    assert.equal(g.proposals!.filter((x) => x.status === "pending").length, 0);
  });

  it("a correct Name Guess on the 20th question still wins", async () => {
    const code = await setup(["h", "g1"]);
    await client.execute("UPDATE rounds SET questions_consumed = 19");
    await approveNameGuess(code, "Sachin Tendulkar");
    const v = await view("c", code);
    assert.equal(v.round!.questionsConsumed, 20);
    assert.equal(v.round!.winner, "guessers");
  });

  it("an incorrect Name Guess on the 20th question makes the Challenger win", async () => {
    const code = await setup(["h", "g1"]);
    await client.execute("UPDATE rounds SET questions_consumed = 19");
    await approveNameGuess(code, "Someone Else");
    const v = await view("g1", code);
    assert.equal(v.status, "results");
    assert.equal(v.round!.questionsConsumed, 20);
    assert.equal(v.round!.winner, "challenger");
  });

  it("exhausting the budget ends the round after the in-flight question is answered", async () => {
    const code = await setup(["h"]);
    await client.execute("UPDATE rounds SET questions_consumed = 19");
    await act("h", code, { type: "propose", kind: "question", content: "Last one?" });
    let v = await view("c", code);
    assert.equal(v.round!.questionsConsumed, 20);
    assert.equal(v.status, "playing", "still waiting for the answer");
    await expectError(act("h", code, { type: "propose", kind: "name_guess", content: "x" }), 409);
    await act("c", code, { type: "answer_question", proposalId: v.round!.inflight!.proposalId, answer: "no" });
    v = await view("h", code);
    assert.equal(v.status, "results");
    assert.equal(v.round!.winner, "challenger");
  });

  it("a hint that uses the last questions ends the round for the Challenger", async () => {
    const code = await setup(["h"]);
    await act("c", code, { type: "offer_hint", category: "Era", text: "x", cost: 20 });
    const [hint] = await pendingOf("h", code);
    await act("h", code, { type: "vote", proposalId: hint.id, vote: "approve" });
    const v = await view("h", code);
    assert.equal(v.round!.winner, "challenger");
    assert.equal(v.round!.questionsConsumed, 20);
  });
});

describe("host controls and next round", () => {
  it("host can abort a stalled round and start a new one with a different Challenger", async () => {
    const code = await setup();
    await act("g1", code, { type: "propose", kind: "question", content: "Q?" });
    await expectError(act("g1", code, { type: "abort_round" }), 403);
    await act("h", code, { type: "abort_round" });
    let v = await view("h", code);
    assert.equal(v.status, "lobby");
    assert.equal(v.pastRounds[0].status, "aborted");
    assert.equal(v.pastRounds[0].secret, null, "aborted rounds don't reveal the secret");

    const g1 = (await view("g1", code)).me!.id;
    await act("h", code, { type: "select_challenger", playerId: g1 });
    await act("g1", code, { type: "start_round", secretName: "Ada Lovelace" });
    v = await view("c", code);
    assert.equal(v.round!.number, 2);
    assert.equal(v.round!.myRole, "guesser");
    assert.equal(v.round!.questionsConsumed, 0);
    assert.equal(v.round!.secret, undefined);
  });

  it("results → lobby → next round", async () => {
    const code = await setup(["h"]);
    await act("h", code, { type: "propose", kind: "name_guess", content: "Sachin Tendulkar" });
    await expectError(act("c", code, { type: "back_to_lobby" }), 403);
    await act("h", code, { type: "back_to_lobby" });
    const v = await view("h", code);
    assert.equal(v.status, "lobby");
    assert.equal(v.pastRounds[0].winner, "guessers");
    assert.equal(v.pastRounds[0].secret, "Sachin Tendulkar");
  });
});
