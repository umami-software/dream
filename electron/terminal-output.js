import { randomUUID } from "node:crypto";

const HIGH_WATERMARK = 256 * 1024;
const LOW_WATERMARK = 64 * 1024;
const BATCH_CHARACTERS = 32 * 1024;
const BATCH_DELAY_MS = 4;

// Count UTF-16 code units consistently across the Electron bridge. Only an
// acknowledgment of a known batch can release its outstanding budget.
export function createTerminalOutput({ projectId, send, pause, resume }) {
  const generation = randomUUID();
  const pending = new Map();
  let chunks = [];
  let queued = 0;
  let outstanding = 0;
  let sequence = 0;
  let timer = null;
  let paused = false;
  let disposed = false;
  let peakOutstanding = 0;
  let pausedAt = 0;
  let pauseDurationMs = 0;
  let maxAcknowledgmentMs = 0;

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (disposed || queued === 0) return;
    const chunk = chunks.join("");
    chunks = [];
    queued = 0;
    const batch = ++sequence;
    pending.set(batch, { length: chunk.length, sentAt: performance.now() });
    send("terminal:data", { projectId, generation, sequence: batch, chunk });
  }

  function write(chunk) {
    if (disposed || !chunk) return;
    outstanding += chunk.length;
    peakOutstanding = Math.max(peakOutstanding, outstanding);
    if (!paused && outstanding >= HIGH_WATERMARK) {
      paused = true;
      pausedAt = performance.now();
      pause();
    }
    // Bound individual IPC messages, including unusually large source chunks.
    for (let offset = 0; offset < chunk.length; ) {
      const part = chunk.slice(offset, offset + BATCH_CHARACTERS - queued);
      chunks.push(part);
      queued += part.length;
      offset += part.length;
      if (queued >= BATCH_CHARACTERS) flush();
    }
    if (queued && timer === null) timer = setTimeout(flush, BATCH_DELAY_MS);
  }

  function acknowledge(event) {
    if (disposed || event.generation !== generation) return;
    const batch = pending.get(event.sequence);
    if (!batch) return;
    pending.delete(event.sequence);
    outstanding -= batch.length;
    maxAcknowledgmentMs = Math.max(
      maxAcknowledgmentMs,
      performance.now() - batch.sentAt,
    );
    if (paused && outstanding <= LOW_WATERMARK) {
      paused = false;
      pauseDurationMs += performance.now() - pausedAt;
      resume();
    }
  }

  function dispose() {
    disposed = true;
    clearTimeout(timer);
    timer = null;
    chunks = [];
    pending.clear();
    queued = 0;
    outstanding = 0;
  }

  return {
    acknowledge,
    dispose,
    flush,
    write,
    getDiagnostics: () => ({
      projectId,
      outstanding,
      queued,
      pendingBatches: pending.size,
      paused,
      peakOutstanding,
      maxAcknowledgmentMs,
      pauseDurationMs:
        pauseDurationMs + (paused ? performance.now() - pausedAt : 0),
    }),
  };
}
