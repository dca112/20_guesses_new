// End-to-end smoke test against a running server: `npm run dev` then `npm run test:e2e`.
// Each simulated player has its own cookie jar (anonymous session).
const BASE = process.env.BASE_URL || "http://localhost:3000";

function player(name) {
  let cookie = "";
  async function call(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const json = await res.json();
    if (!res.ok) throw new Error(`${name} ${method} ${path}: ${res.status} ${json.error}`);
    return json;
  }
  return {
    name,
    create: () => call("POST", "/api/rooms", { displayName: name }),
    join: (code) => call("POST", `/api/rooms/${code}/join`, { displayName: name }),
    state: (code) => call("GET", `/api/rooms/${code}/state`),
    act: (code, a) => call("POST", `/api/rooms/${code}/action`, a),
  };
}

function check(cond, msg) {
  if (!cond) throw new Error("FAILED: " + msg);
  console.log("  ✓ " + msg);
}

const [host, vikram, rahul, neha] = ["Host", "Vikram", "Rahul", "Neha"].map(player);
const { code } = await host.create();
console.log(`Room ${code}`);
for (const p of [vikram, rahul, neha]) await p.join(code);
const again = await rahul.join(code);
check(again.players.length === 4, "rejoin keeps 4 players");

const vId = (await vikram.state(code)).me.id;
await host.act(code, { type: "select_challenger", playerId: vId });
await vikram.act(code, { type: "start_round", secretName: "Sachin Tendulkar" });

let s = await rahul.state(code);
check(s.status === "playing" && s.round.myRole === "guesser", "Rahul is a guesser");
check(!JSON.stringify(s).includes("Sachin"), "guesser cannot see secret");

await rahul.act(code, { type: "send_message", content: "Sportsperson?" });
s = await rahul.act(code, { type: "propose", kind: "question", content: "Is the person associated with sports?" });
const pid = s.round.proposals[0].id;
const cv = await vikram.state(code);
check(!JSON.stringify(cv).includes("Sportsperson") && !JSON.stringify(cv).includes("associated with sports"), "challenger sees no chat or pending proposals");

await neha.act(code, { type: "vote", proposalId: pid, vote: "approve" });
s = await vikram.state(code);
check(s.round.inflight?.content === "Is the person associated with sports?", "approved question reaches challenger");
check(s.round.questionsConsumed === 1, "counter is 1/20");
await vikram.act(code, { type: "answer_question", proposalId: s.round.inflight.proposalId, answer: "yes" });

await vikram.act(code, { type: "offer_hint", category: "Geographical location", text: "The person is from India", cost: 3 });
s = await neha.state(code);
check(!JSON.stringify(s).includes("from India"), "hint text hidden before vote");
const hid = s.round.proposals.find((p) => p.type === "hint" && p.status === "pending").id;
await Promise.allSettled([host, rahul, neha].map((p) => p.act(code, { type: "vote", proposalId: hid, vote: "approve" })));
s = await neha.state(code);
check(s.round.questionsConsumed === 4, "hint cost deducted exactly once (1 + 3)");
check(JSON.stringify(s.round.history).includes("from India"), "hint revealed after approval");

s = await neha.act(code, { type: "propose", kind: "final_guess", content: "Sachin" });
const gid = s.round.proposals.find((p) => p.type === "final_guess" && p.status === "pending").id;
await host.act(code, { type: "vote", proposalId: gid, vote: "approve" });
s = await vikram.state(code);
await vikram.act(code, { type: "validate_guess", proposalId: s.round.inflight.proposalId, correct: true });
s = await rahul.state(code);
check(s.status === "results" && s.round.winner === "guessers", "team wins");
check(s.round.secret === "Sachin Tendulkar", "secret revealed in results");

await host.act(code, { type: "back_to_lobby" });
const rId = (await rahul.state(code)).me.id;
await host.act(code, { type: "select_challenger", playerId: rId });
await rahul.act(code, { type: "start_round", secretName: "Ada Lovelace" });
s = await vikram.state(code);
check(s.round.number === 2 && s.round.myRole === "guesser", "round 2 with a new Challenger");
console.log(`\nAll checks passed. Open ${BASE}/room/${code}`);
