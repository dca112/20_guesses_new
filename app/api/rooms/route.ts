import { NextResponse } from "next/server";
import { createRoom } from "@/lib/game";
import { errorResponse, readJson } from "@/lib/http";
import { getSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const sid = await getSessionId();
    const { code } = await createRoom(sid, body.displayName);
    return NextResponse.json({ code });
  } catch (err) {
    return errorResponse(err);
  }
}
