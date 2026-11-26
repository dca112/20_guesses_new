"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameAction, RoomView } from "@/lib/types";

const POLL_VISIBLE_MS = 1500;
const POLL_HIDDEN_MS = 6000;

/**
 * Keeps a role-filtered room view in sync with the server by polling.
 * Responses older than the version already shown are discarded, so an
 * in-flight poll can never overwrite the result of a newer action.
 */
export function useRoom(code: string) {
  const [view, setView] = useState<RoomView | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const versionRef = useRef(-1);

  const accept = useCallback((next: RoomView) => {
    if (next.version < versionRef.current) return;
    versionRef.current = next.version;
    setView(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${code}/state`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setLoadError({ status: res.status, message: json.error ?? "Could not load room" });
        return;
      }
      setLoadError(null);
      setConnected(true);
      accept(json as RoomView);
    } catch {
      setConnected(false);
    }
  }, [code, accept]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(tick, document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    };
    tick();
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [refresh]);

  const act = useCallback(
    async (action: GameAction): Promise<boolean> => {
      setActionError(null);
      try {
        const res = await fetch(`/api/rooms/${code}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        });
        const json = await res.json();
        if (!res.ok) {
          setActionError(json.error ?? "Action failed");
          refresh();
          return false;
        }
        accept(json as RoomView);
        return true;
      } catch {
        setActionError("Network error — please try again");
        return false;
      }
    },
    [code, accept, refresh],
  );

  const join = useCallback(
    async (displayName: string): Promise<string | null> => {
      try {
        const res = await fetch(`/api/rooms/${code}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName }),
        });
        const json = await res.json();
        if (!res.ok) return json.error ?? "Could not join";
        accept(json as RoomView);
        return null;
      } catch {
        return "Network error — please try again";
      }
    },
    [code, accept],
  );

  return { view, loadError, actionError, clearActionError: () => setActionError(null), connected, act, join, refresh };
}

export type Act = (action: GameAction) => Promise<boolean>;

export function clientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
