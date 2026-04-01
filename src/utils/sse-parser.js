export function parseSSEEventsFromBuffer(buffer) {
  const events = [];
  const normalized = String(buffer || '').replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() || '';

  for (const block of blocks) {
    const dataLines = block
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    events.push(dataLines.join('\n'));
  }

  return { events, rest };
}

