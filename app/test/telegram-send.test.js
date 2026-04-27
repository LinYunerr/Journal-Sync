import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scriptPath = path.resolve('Plugin/Telegram-Send/telegram_send.py');

function buildCleanTelegramEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.TELEGRAM_CHANNELS_FILE;
  delete env.TELEGRAM_BOT_TOKEN_FILE;
  delete env.JOURNAL_SYNC_TELEGRAM_CONFIG_FILE;
  delete env.TELEGRAM_BOT_TOKEN;
  return { ...env, ...overrides };
}

function importTelegramSenderExpression(expression, { env } = {}) {
  const python = [
    'import importlib.util, json',
    `spec = importlib.util.spec_from_file_location("telegram_send", ${JSON.stringify(scriptPath)})`,
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    `print(json.dumps(${expression}, ensure_ascii=False))`
  ].join('\n');

  return JSON.parse(execFileSync('python3', ['-c', python], { encoding: 'utf8', env }).trim());
}

function formatMessageHtml({ text, sourceUrl = null, boldFirstLine = false, lineBreakPerLine = false }) {
  const sourceUrlLiteral = sourceUrl === null ? 'None' : JSON.stringify(sourceUrl);
  const python = [
    'import importlib.util, json',
    `spec = importlib.util.spec_from_file_location("telegram_send", ${JSON.stringify(scriptPath)})`,
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    `result = mod.format_message_html(${JSON.stringify(text)}, bold_first_line=${boldFirstLine ? 'True' : 'False'}, source_url=${sourceUrlLiteral}, line_break_per_line=${lineBreakPerLine ? 'True' : 'False'})`,
    'print(json.dumps(result, ensure_ascii=False))'
  ].join('\n');

  return JSON.parse(execFileSync('python3', ['-c', python], { encoding: 'utf8' }).trim());
}

test('telegram sender default runtime paths are under portable user-data', () => {
  const paths = importTelegramSenderExpression(
    '{"config": mod.PLUGIN_CONFIG_PATH, "channels": mod.KNOWN_CHANNELS_PATH, "token": mod.TOKEN_FALLBACK_PATH}',
    { env: buildCleanTelegramEnv() }
  );
  const telegramDataDir = path.join(path.dirname(process.cwd()), 'user-data', 'plugins', 'telegram');

  assert.equal(paths.config, path.join(telegramDataDir, 'config.json'));
  assert.equal(paths.channels, path.join(telegramDataDir, 'channels.json'));
  assert.equal(paths.token, path.join(telegramDataDir, 'telegram_bot_token.txt'));
});

test('telegram sender honors JOURNAL_SYNC_DATA_DIR for standalone defaults', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-sync-telegram-data-dir-'));

  try {
    const paths = importTelegramSenderExpression(
      '{"config": mod.PLUGIN_CONFIG_PATH, "channels": mod.KNOWN_CHANNELS_PATH, "token": mod.TOKEN_FALLBACK_PATH}',
      {
        env: buildCleanTelegramEnv({
          JOURNAL_SYNC_DATA_DIR: tempDir
        })
      }
    );
    const telegramDataDir = path.join(tempDir, 'plugins', 'telegram');

    assert.equal(paths.config, path.join(telegramDataDir, 'config.json'));
    assert.equal(paths.channels, path.join(telegramDataDir, 'channels.json'));
    assert.equal(paths.token, path.join(telegramDataDir, 'telegram_bot_token.txt'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('telegram sender can read standalone token from plugin config path', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-sync-telegram-config-'));
  const configFile = path.join(tempDir, 'plugins', 'telegram', 'config.json');

  try {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ botToken: '123456:abcdefghijklmnopqrstuvwxyz' }), 'utf8');

    const token = importTelegramSenderExpression(
      'mod.read_token()',
      {
        env: buildCleanTelegramEnv({
          JOURNAL_SYNC_TELEGRAM_CONFIG_FILE: configFile
        })
      }
    );

    assert.equal(token, '123456:abcdefghijklmnopqrstuvwxyz');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

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

test('telegram sender converts first-line markdown bold to html bold without literal asterisks', () => {
  const html = formatMessageHtml({
    text: '**首行标题**\n正文'
  });

  assert.equal(html, '<b>首行标题</b>\n正文');
});

test('telegram sender avoids nested asterisks when bold option meets markdown-bold first line', () => {
  const html = formatMessageHtml({
    text: '**首行标题**\n正文',
    boldFirstLine: true
  });

  assert.equal(html, '<b>首行标题</b>\n正文');
});
