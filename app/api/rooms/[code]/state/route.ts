import { NextResponse } from "next/server";
import { getRoomView } from "@/lib/game";
import { errorResponse, noStore } from "@/lib/http";
import { getSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Role-filtered room state. Polled by clients for real-time updates. */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const sid = await getSessionId();
    return NextResponse.json(await getRoomView(sid, code), { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
