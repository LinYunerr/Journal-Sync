import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiaryFilename } from '../Plugin/Obsidian-Local/index.js';

test('buildDiaryFilename supports default and custom Y/M/D patterns', () => {
  assert.equal(
    buildDiaryFilename('2026-04-25', 'YYYY-MM-DD 日记'),
    '2026-04-25 日记.md'
  );

  assert.equal(
    buildDiaryFilename('2026-04-25', 'YY-M-D'),
    '26-4-5.md'
  );

  assert.equal(
    buildDiaryFilename('2026-12-09', 'YYYYY-MMM-DDD'),
    '02026-012-009.md'
  );
});

test('buildDiaryFilename keeps literal text and avoids duplicate extensions', () => {
  assert.equal(
    buildDiaryFilename('2026-04-25', '日记'),
    '日记.md'
  );

  assert.equal(
    buildDiaryFilename('2026-04-25', 'YYYY-MM-DD.md'),
    '2026-04-25.md'
  );
});
