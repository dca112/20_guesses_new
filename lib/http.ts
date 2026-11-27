import { NextResponse } from "next/server";
import { DatabaseConfigError } from "./db";
import { GameError } from "./game";

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof GameError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const msg = String((err as { message?: string })?.message ?? err);
  if (/UNIQUE constraint failed/i.test(msg)) {
    return NextResponse.json({ error: "That action was already processed" }, { status: 409 });
  }
  if (/CHECK constraint failed/i.test(msg)) {
    return NextResponse.json({ error: "That action is not allowed" }, { status: 409 });
  }
  if (err instanceof DatabaseConfigError) {
    console.error(err.message);
    return NextResponse.json({ error: `Server misconfigured: ${err.message}` }, { status: 500 });
  }
  if (/ConnectionFailed|Unable to open connection|SERVER_ERROR|UNAUTHORIZED|401|ENOTFOUND/i.test(msg)) {
    console.error(err);
    return NextResponse.json(
      { error: "Could not connect to the database. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN." },
      { status: 503 },
    );
  }
  console.error(err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

export const noStore = { "Cache-Control": "no-store" };
