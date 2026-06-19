// Sound + browser-notification helpers for signal alerts.

let audioCtx: AudioContext | null = null;
function ctx(): AudioContext {
  if (!audioCtx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    audioCtx = new AC();
  }
  return audioCtx;
}

/** Short multi-tone beep. `up` = ascending (buy), else descending (sell). */
export function beep(up = true): void {
  try {
    const ac = ctx();
    const notes = up ? [523, 659, 784, 1046] : [784, 587, 466, 349];
    notes.forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = "triangle";
      osc.frequency.value = freq;
      const t = ac.currentTime + i * 0.1;
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  } catch {
    /* audio not available */
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const res = await Notification.requestPermission();
  return res === "granted";
}

export function notify(title: string, body: string): void {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification(title, { body, silent: false });
    } catch {
      /* ignore */
    }
  }
}

function toAscii(s: string): string {
  return s
    .replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue")
    .replace(/[^\x20-\x7E]/g, "");
}

export async function pushNtfy(topic: string, title: string, body: string, tags: string[] = []): Promise<void> {
  if (!topic) return;
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        Title: toAscii(title),
        Tags: tags.join(","),
        Priority: "high",
      },
      body: toAscii(body),
    });
  } catch {
    /* network error — silent fail, don't break the app */
  }
}
