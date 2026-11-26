import { NextResponse } from "next/server";
import { getRoomView, joinRoom } from "@/lib/game";
import { errorResponse, noStore, readJson } from "@/lib/http";
import { getSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const body = await readJson(req);
    const sid = await getSessionId();
    await joinRoom(sid, code, body.displayName);
    return NextResponse.json(await getRoomView(sid, code), { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
