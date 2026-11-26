import { cookies } from "next/headers";

export const SESSION_COOKIE = "tg_sid";
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Anonymous session identity. A random id stored in an httpOnly cookie lets
 * players refresh or reconnect and keep the same identity without registering.
 */
export async function getSessionId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  if (existing && /^[a-f0-9-]{36}$/.test(existing)) return existing;
  const id = crypto.randomUUID();
  jar.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
  return id;
}
