'use strict';

/**
 * Bluesky record constraints and pure rich-text helpers.
 *
 * Keep protocol limits here so validation, execution, and tests share one
 * source of truth. Networking and user-facing messages remain in the adapter.
 * Sources: app.bsky.feed.post and app.bsky.embed.images in
 * https://github.com/bluesky-social/atproto/tree/main/lexicons/app/bsky
 */

const MAX_GRAPHEMES = 300;
const MAX_TEXT_BYTES = 3000;
const MAX_IMAGE_BYTES = 2000000;
const MAX_IMAGES = 4;

const SUPPORTED_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);
const supportedImageMimeSet = new Set(SUPPORTED_IMAGE_MIME_TYPES);

const ALWAYS_TRIM_TRAILING = new Set([
  '.', ',', ';', ':', '!', '?', "'", '"',
  '。', '，', '；', '：', '！', '？', '、', '》', '〉', '」', '』'
]);
const CLOSING_DELIMITERS = Object.freeze({
  ')': '(',
  ']': '[',
  '}': '{',
  '）': '（',
  '】': '【'
});

let graphemeSegmenter = null;

function isSupportedImageMime(mimeType) {
  return supportedImageMimeSet.has(String(mimeType || '').toLowerCase());
}

function graphemeLength(text) {
  const value = String(text || '');
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    if (!graphemeSegmenter) {
      graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    }
    return Array.from(graphemeSegmenter.segment(value)).length;
  }
  // Safe fallback for older WebViews: code points may over-count a visual
  // grapheme, but never allow a clearly over-limit post through unchecked.
  return Array.from(value).length;
}

function utf8Length(text) {
  return new TextEncoder().encode(String(text || '')).byteLength;
}

function measurePostText(text) {
  const value = String(text || '');
  return {
    graphemes: graphemeLength(value),
    utf8Bytes: utf8Length(value)
  };
}

function countCharacter(value, character) {
  let count = 0;
  for (const current of value) {
    if (current === character) count += 1;
  }
  return count;
}

/**
 * Remove prose punctuation after a URL while preserving delimiters that are
 * balanced inside the URL itself. This keeps URLs such as Wikipedia's
 * `Function_(mathematics)` intact while still trimming Markdown's closing `)`.
 */
function trimTrailingUrlPunctuation(rawUrl) {
  let url = String(rawUrl || '');

  while (url) {
    const trailing = url.charAt(url.length - 1);
    if (ALWAYS_TRIM_TRAILING.has(trailing)) {
      url = url.slice(0, -1);
      continue;
    }

    const opening = CLOSING_DELIMITERS[trailing];
    if (opening && countCharacter(url, trailing) > countCharacter(url, opening)) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }

  return url;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Build Bluesky link facets using UTF-8 byte offsets, as required by the
 * app.bsky.richtext.facet lexicon.
 */
function buildLinkFacets(text) {
  const value = String(text || '');
  const facets = [];
  if (!value) return facets;

  const encoder = new TextEncoder();
  const regex = /https?:\/\/[^\s<>"]+/g;
  let match;
  while ((match = regex.exec(value)) !== null) {
    const url = trimTrailingUrlPunctuation(match[0]);
    if (!url || !isHttpUrl(url)) continue;

    const byteStart = encoder.encode(value.slice(0, match.index)).byteLength;
    const byteEnd = byteStart + encoder.encode(url).byteLength;
    facets.push({
      $type: 'app.bsky.richtext.facet',
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }]
    });
  }

  return facets;
}

module.exports = {
  MAX_GRAPHEMES,
  MAX_TEXT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  SUPPORTED_IMAGE_MIME_TYPES,
  isSupportedImageMime,
  measurePostText,
  trimTrailingUrlPunctuation,
  buildLinkFacets
};
