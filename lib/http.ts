import { NextResponse } from "next/server";
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
