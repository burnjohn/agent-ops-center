export interface SseMessage {
  id?: string;
  event: string;
  data: string;
}

/** Parses SSE wire text into messages; comment-only blocks (": ...") are skipped. */
export function parseSse(text: string): SseMessage[] {
  const out: SseMessage[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let id: string | undefined;
    let event = 'message';
    const data: string[] = [];
    let any = false;
    for (const line of block.split(/\r?\n/)) {
      if (line === '' || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i === -1 ? line : line.slice(0, i);
      const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'id') id = value;
      else if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
      else continue;
      any = true;
    }
    if (any)
      out.push(
        id === undefined ? { event, data: data.join('\n') } : { id, event, data: data.join('\n') },
      );
  }
  return out;
}

/**
 * Reads a listening server's SSE stream until `count` messages arrived (or `timeoutMs` elapsed),
 * then aborts the connection. Returns the messages received.
 */
export async function readSse(
  url: string,
  opts: { count: number; headers?: Record<string, string>; timeoutMs?: number },
): Promise<SseMessage[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000);
  let buffer = '';
  let messages: SseMessage[] = [];
  try {
    const res = await fetch(url, {
      headers: { accept: 'text/event-stream', ...opts.headers },
      signal: ctrl.signal,
    });
    if (res.body === null) throw new Error('SSE response has no body');
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    while (messages.length < opts.count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const cut = buffer.lastIndexOf('\n\n');
      if (cut !== -1) messages = parseSse(buffer.slice(0, cut + 2));
    }
  } catch (err) {
    if (!ctrl.signal.aborted) throw err;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
  return messages;
}
