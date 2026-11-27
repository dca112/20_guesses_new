"use client";

import type { Howl as HowlType } from "howler";

/**
 * Crowd applause (a real recording, see public/sounds/CREDITS.md) played
 * through Howler.js. Loaded lazily and preloaded while a round is running so
 * the celebration can start instantly.
 */
let applause: Promise<HowlType> | null = null;

export function loadApplause(): Promise<HowlType> {
  if (!applause) {
    applause = import("howler").then(
      ({ Howl }) =>
        new Howl({
          src: ["/sounds/applause.webm", "/sounds/applause.mp3"],
          preload: true,
          volume: 0.9,
        }),
    );
  }
  return applause;
}

/** Whether the browser's audio is currently allowed to play (needs a prior user gesture). */
export async function audioUnlocked(): Promise<boolean> {
  const { Howler } = await import("howler");
  return !Howler.ctx || Howler.ctx.state === "running";
}

/**
 * Plays a fuller "crowd" by layering the recording with a slightly slower,
 * delayed copy. Returns a stop function.
 */
export async function playApplause(): Promise<() => void> {
  const howl = await loadApplause();
  const { Howler } = await import("howler");
  if (Howler.ctx && Howler.ctx.state === "suspended") {
    try {
      await Howler.ctx.resume();
    } catch {}
  }
  const ids: number[] = [];
  ids.push(howl.play());
  howl.volume(0.9, ids[0]);
  const t = setTimeout(() => {
    const id = howl.play();
    howl.rate(0.93, id);
    howl.volume(0.55, id);
    ids.push(id);
  }, 280);
  return () => {
    clearTimeout(t);
    for (const id of ids) howl.fade(howl.volume(id) as number, 0, 400, id);
    setTimeout(() => ids.forEach((id) => howl.stop(id)), 450);
  };
}
