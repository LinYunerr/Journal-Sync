import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSSEEventsFromBuffer } from '../src/utils/sse-parser.js';

test('parseSSEEventsFromBuffer handles split chunks correctly', () => {
  let buffer = '';
  const parsedPayloads = [];

  const chunks = [
    'data: {"type":"status","plugin":"obsidian","success":true}\n\n',
    'data: {"type":"status","plugin":"telegram"',
    ',"success":true}\n\n'
  ];

  for (const chunk of chunks) {
    buffer += chunk;
    const { events, rest } = parseSSEEventsFromBuffer(buffer);
    parsedPayloads.push(...events);
    buffer = rest;
  }

  assert.equal(parsedPayloads.length, 2);
  assert.equal(JSON.parse(parsedPayloads[0]).plugin, 'obsidian');
  assert.equal(JSON.parse(parsedPayloads[1]).plugin, 'telegram');
});

test('parseSSEEventsFromBuffer keeps incomplete frame in rest', () => {
  const { events, rest } = parseSSEEventsFromBuffer('data: {"type":"error","message":"x"}');
  assert.equal(events.length, 0);
  assert.equal(rest, 'data: {"type":"error","message":"x"}');
});
