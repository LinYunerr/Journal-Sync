import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const scriptPath = path.resolve('Plugin/Telegram-Send/telegram_send.py');

function formatMessageHtml({ text, sourceUrl, boldFirstLine = false, lineBreakPerLine = false }) {
  const python = [
    'import importlib.util, json',
    `spec = importlib.util.spec_from_file_location("telegram_send", ${JSON.stringify(scriptPath)})`,
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    `result = mod.format_message_html(${JSON.stringify(text)}, bold_first_line=${boldFirstLine ? 'True' : 'False'}, source_url=${JSON.stringify(sourceUrl)}, line_break_per_line=${lineBreakPerLine ? 'True' : 'False'})`,
    'print(json.dumps(result, ensure_ascii=False))'
  ].join('\n');

  return JSON.parse(execFileSync('python3', ['-c', python], { encoding: 'utf8' }).trim());
}

test('telegram sender rewrites trailing source text into a single HTML link', () => {
  const html = formatMessageHtml({
    text: '这是一段内容\nsource https://example.com/post',
    sourceUrl: 'https://example.com/post'
  });

  assert.equal(
    html,
    '这是一段内容 <a href="https://example.com/post">source</a>'
  );
});

test('telegram sender rewrites trailing bare url into a single HTML source link', () => {
  const html = formatMessageHtml({
    text: '这是一段内容\nhttps://example.com/post',
    sourceUrl: 'https://example.com/post'
  });

  assert.equal(
    html,
    '这是一段内容 <a href="https://example.com/post">source</a>'
  );
});

test('telegram sender rewrites split source and url tail into a single HTML source link', () => {
  const html = formatMessageHtml({
    text: '这是一段内容\nsource\nhttps://example.com/post',
    sourceUrl: 'https://example.com/post'
  });

  assert.equal(
    html,
    '这是一段内容 <a href="https://example.com/post">source</a>'
  );
});

test('telegram sender still appends source link when source text is absent', () => {
  const html = formatMessageHtml({
    text: '这是一段内容',
    sourceUrl: 'https://example.com/post'
  });

  assert.equal(
    html,
    '这是一段内容 <a href="https://example.com/post">source</a>'
  );
});

test('telegram sender rewrites normalized bilibili source with trailing slash', () => {
  const html = formatMessageHtml({
    text: 'source https://www.bilibili.com/video/BV1zNoVB1EWb/',
    sourceUrl: 'https://www.bilibili.com/video/BV1zNoVB1EWb'
  });

  assert.equal(
    html,
    '<a href="https://www.bilibili.com/video/BV1zNoVB1EWb">source</a>'
  );
});
