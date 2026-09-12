const MAX_SCROLLBACK_CHARACTERS = 150_000;

interface TerminalScrollbackBuffer {
  chunks: string[];
  firstChunkOffset: number;
  firstChunkIndex: number;
  length: number;
}

type TerminalOutputListener = (chunk: string, processed: () => void) => void;

interface TerminalOutputSubscription {
  listener: TerminalOutputListener;
  pending: Set<() => void>;
}

const scrollbackBySessionId = new Map<string, TerminalScrollbackBuffer>();
const listenersBySessionId = new Map<string, Set<TerminalOutputSubscription>>();

const createBuffer = (): TerminalScrollbackBuffer => ({
  chunks: [],
  firstChunkOffset: 0,
  firstChunkIndex: 0,
  length: 0,
});

const compactDiscardedChunks = (buffer: TerminalScrollbackBuffer) => {
  if (
    buffer.firstChunkIndex >= 1_024 &&
    buffer.firstChunkIndex * 2 >= buffer.chunks.length
  ) {
    buffer.chunks.splice(0, buffer.firstChunkIndex);
    buffer.firstChunkIndex = 0;
  }
};

const appendToBuffer = (buffer: TerminalScrollbackBuffer, chunk: string) => {
  if (chunk.length >= MAX_SCROLLBACK_CHARACTERS) {
    buffer.chunks = [chunk.slice(-MAX_SCROLLBACK_CHARACTERS)];
    buffer.firstChunkOffset = 0;
    buffer.firstChunkIndex = 0;
    buffer.length = MAX_SCROLLBACK_CHARACTERS;
    return;
  }

  buffer.chunks.push(chunk);
  buffer.length += chunk.length;

  let charactersToDiscard = buffer.length - MAX_SCROLLBACK_CHARACTERS;
  while (charactersToDiscard > 0) {
    const firstChunk = buffer.chunks[buffer.firstChunkIndex];
    if (firstChunk === undefined) {
      buffer.chunks = [];
      buffer.firstChunkOffset = 0;
      buffer.firstChunkIndex = 0;
      buffer.length = 0;
      return;
    }

    const availableCharacters = firstChunk.length - buffer.firstChunkOffset;
    if (charactersToDiscard < availableCharacters) {
      buffer.firstChunkOffset += charactersToDiscard;
      buffer.length -= charactersToDiscard;
      compactDiscardedChunks(buffer);
      return;
    }

    buffer.firstChunkIndex += 1;
    buffer.firstChunkOffset = 0;
    buffer.length -= availableCharacters;
    charactersToDiscard -= availableCharacters;
  }

  compactDiscardedChunks(buffer);
};

export const resetTerminalScrollback = (sessionId: string) => {
  scrollbackBySessionId.set(sessionId, createBuffer());
};

export const deleteTerminalScrollback = (sessionId: string) => {
  scrollbackBySessionId.delete(sessionId);
  for (const subscription of listenersBySessionId.get(sessionId) ?? []) {
    for (const processed of subscription.pending) processed();
  }
  listenersBySessionId.delete(sessionId);
};

export const hasTerminalScrollback = (sessionId: string) =>
  scrollbackBySessionId.has(sessionId);

export const getTerminalScrollback = (sessionId: string) => {
  const buffer = scrollbackBySessionId.get(sessionId);
  if (!buffer || buffer.chunks.length === 0) {
    return "";
  }

  const [firstChunk, ...remainingChunks] = buffer.chunks.slice(
    buffer.firstChunkIndex,
  );
  return [
    firstChunk?.slice(buffer.firstChunkOffset) ?? "",
    ...remainingChunks,
  ].join("");
};

export const publishTerminalOutput = (
  sessionId: string,
  chunk: string,
  acknowledge: () => void = () => {},
) => {
  const buffer = scrollbackBySessionId.get(sessionId);
  if (!buffer || !chunk) {
    acknowledge();
    return false;
  }

  appendToBuffer(buffer, chunk);
  const subscriptions = [...(listenersBySessionId.get(sessionId) ?? [])];
  let remaining = subscriptions.length;
  if (remaining === 0) acknowledge();
  for (const subscription of subscriptions) {
    const processed = () => {
      if (!subscription.pending.delete(processed)) return;
      remaining -= 1;
      if (remaining === 0) acknowledge();
    };
    subscription.pending.add(processed);
    try {
      subscription.listener(chunk, processed);
    } catch (error) {
      // A disposed/failed consumer must not strand the producer or other views.
      processed();
      console.error("Terminal output consumer failed", error);
    }
  }

  return true;
};

export const subscribeToTerminalOutput = (
  sessionId: string,
  listener: TerminalOutputListener,
) => {
  let listeners = listenersBySessionId.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    listenersBySessionId.set(sessionId, listeners);
  }
  const subscription = { listener, pending: new Set<() => void>() };
  listeners.add(subscription);

  return () => {
    listeners.delete(subscription);
    for (const processed of subscription.pending) processed();
    if (
      listeners.size === 0 &&
      listenersBySessionId.get(sessionId) === listeners
    ) {
      listenersBySessionId.delete(sessionId);
    }
  };
};
