'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const bluesky = require('../src/adapters/bluesky');
const {
  MAX_IMAGE_BYTES,
  measurePostText,
  buildLinkFacets
} = require('../src/adapters/bluesky-core');

function imagePayload(size, text = '') {
  return {
    plainText: text,
    attachments: [{
      kind: 'image',
      filename: 'photo.jpg',
      vaultPath: 'assets/photo.jpg',
      mimeType: 'image/jpeg'
    }],
    readAttachment: async () => new ArrayBuffer(size)
  };
}

test('preserves balanced parentheses and trims surrounding punctuation in URL facets', () => {
  const text = '详见 https://en.wikipedia.org/wiki/Function_(mathematics)。 ' +
    '[mirror](https://example.com/archive_(v2))';
  const facets = buildLinkFacets(text);

  assert.equal(facets.length, 2);
  assert.equal(
    facets[0].features[0].uri,
    'https://en.wikipedia.org/wiki/Function_(mathematics)'
  );
  assert.equal(facets[1].features[0].uri, 'https://example.com/archive_(v2)');

  const encoded = new TextEncoder().encode(text);
  const decoder = new TextDecoder();
  for (const facet of facets) {
    const visibleSlice = decoder.decode(encoded.slice(facet.index.byteStart, facet.index.byteEnd));
    assert.equal(visibleSlice, facet.features[0].uri);
  }
});

test('measures both grapheme clusters and UTF-8 bytes', () => {
  const familyEmoji = '👨‍👩‍👧‍👦'.repeat(150);
  assert.deepEqual(measurePostText(familyEmoji), {
    graphemes: 150,
    utf8Bytes: 3750
  });
});

test('rejects text that fits the grapheme limit but exceeds the UTF-8 limit', async () => {
  const result = await bluesky.validate({
    payload: { plainText: '👨‍👩‍👧‍👦'.repeat(150), attachments: [] }
  });

  assert.match(result.errors.join('\n'), /UTF-8 上限 3000 字节/);
});

test('rejects an image above the 2 MB record limit before sending', async () => {
  const result = await bluesky.validate({ payload: imagePayload(MAX_IMAGE_BYTES + 1, '图片') });
  assert.match(result.errors.join('\n'), /单张图片上限 2 MB/);
});

test('accepts an image exactly at the 2 MB record limit', async () => {
  const result = await bluesky.validate({ payload: imagePayload(MAX_IMAGE_BYTES, '图片') });
  assert.deepEqual(result.errors, []);
});

test('execute blocks an oversized image without making a network request', async () => {
  let requestCount = 0;
  const result = await bluesky.execute({
    config: { identifier: 'tester.bsky.social', appPassword: 'test-app-password' },
    payload: imagePayload(MAX_IMAGE_BYTES + 1, '图片'),
    requestUrl: async () => {
      requestCount += 1;
      throw new Error('network should not be called');
    }
  });

  assert.equal(result.success, false);
  assert.match(result.error, /单张图片上限 2 MB/);
  assert.equal(requestCount, 0);
});

test('execute reuses the validated image buffer and creates a valid post record', async () => {
  const calls = [];
  let readCount = 0;
  const blob = {
    $type: 'blob',
    ref: { $link: 'bafkreitest' },
    mimeType: 'image/jpeg',
    size: 4
  };
  const payload = imagePayload(4, '链接 https://en.wikipedia.org/wiki/Function_(mathematics)');
  payload.readAttachment = async () => {
    readCount += 1;
    return new ArrayBuffer(4);
  };

  const result = await bluesky.execute({
    config: { identifier: 'tester.bsky.social', appPassword: 'test-app-password' },
    payload,
    requestUrl: async options => {
      calls.push(options);
      if (options.url.endsWith('/com.atproto.server.createSession')) {
        return {
          status: 200,
          json: { accessJwt: 'access-jwt', did: 'did:plc:test', handle: 'tester.bsky.social' }
        };
      }
      if (options.url.endsWith('/com.atproto.repo.uploadBlob')) {
        assert.equal(options.body.byteLength, 4);
        return { status: 200, json: { blob } };
      }
      if (options.url.endsWith('/com.atproto.repo.createRecord')) {
        const body = JSON.parse(options.body);
        assert.deepEqual(body.record.embed.images[0].image, blob);
        assert.equal(
          body.record.facets[0].features[0].uri,
          'https://en.wikipedia.org/wiki/Function_(mathematics)'
        );
        return { status: 200, json: { uri: 'at://did:plc:test/app.bsky.feed.post/3test' } };
      }
      throw new Error(`unexpected request: ${options.url}`);
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.url, 'https://bsky.app/profile/tester.bsky.social/post/3test');
  assert.equal(readCount, 1);
  assert.equal(calls.length, 3);
});
