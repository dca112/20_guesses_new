import { NextResponse } from "next/server";
import { getRoomView, performAction } from "@/lib/game";
import { errorResponse, noStore, readJson } from "@/lib/http";
import { getSessionId } from "@/lib/session";
import type { GameAction } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Single entry point for every game action; responds with the fresh role-filtered state. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const action = (await readJson(req)) as unknown as GameAction;
    const sid = await getSessionId();
    await performAction(sid, code, action);
    return NextResponse.json(await getRoomView(sid, code), { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
