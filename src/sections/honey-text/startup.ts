const listeners = new Set<(amount: number) => void>();
let progress = 0;

/** Marks a startup stage. Safe to import during a server render. */
export function traceStartup(stage: string, amount?: number) {
  if (typeof location !== "undefined") {
    if (new URLSearchParams(location.search).has("debug"))
      console.info("[r3f startup]", stage, Math.round(performance.now()), "ms");
  }
  if (amount === undefined || amount <= progress) return;
  progress = amount;
  listeners.forEach((listener) => listener(amount));
}

export function onStartupProgress(listener: (amount: number) => void) {
  listener(progress);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
