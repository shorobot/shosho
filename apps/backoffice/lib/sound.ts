// "Sound on new order": a short two-tone chime synthesised with WebAudio (no asset, no download).
// Browsers require a user gesture before audio can play — the toggle click in the header unlocks it.
const KEY = "shosho.bo.sound";

let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (on) unlock();
}

function unlock() {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function chime() {
  if (!soundEnabled()) return;
  unlock();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  [[880, 0], [1174.66, 0.16]].forEach(([freq, dt]) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.type = "sine";
    o.frequency.value = freq!;
    g.gain.setValueAtTime(0.0001, t0 + dt!);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + dt! + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt! + 0.35);
    o.connect(g).connect(ctx!.destination);
    o.start(t0 + dt!);
    o.stop(t0 + dt! + 0.4);
  });
}
