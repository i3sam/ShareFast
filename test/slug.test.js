import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSlug, normalizeSlug } from '../public/assets/js/slug.js';
import { isValidSlug, randomWord, randomWordWithNumber } from '../server/slug.js';

test('accepts simple lowercase slugs', () => {
  for (const slug of ['abc', 'my-photos', 'trip-2026', 'a1b2c3']) {
    assert.equal(isValidSlug(slug), true, slug);
  }
});

test('rejects malformed and reserved slugs', () => {
  for (const slug of ['ab', '-abc', 'abc-', 'a--b', 'ABC', 'has space', 'x'.repeat(41), 'api', 'assets', 42]) {
    assert.equal(isValidSlug(slug), false, String(slug));
  }
});

test('generated links are single valid words', () => {
  for (let i = 0; i < 500; i++) {
    for (const slug of [randomWord(), randomWordWithNumber()]) {
      assert.match(slug, /^[a-z]+\d*$/);
      assert.equal(isValidSlug(slug), true, slug);
    }
  }
});

test('normalizes typed input', () => {
  assert.equal(normalizeSlug('My Photos!'), 'my-photos');
  assert.equal(normalizeSlug('trip__2026'), 'trip-2026');
});

test('extracts a slug from a pasted link', () => {
  assert.equal(extractSlug('https://sharefast.essam.biz/otter'), 'otter');
  assert.equal(extractSlug('sharefast.essam.biz/otter/?x=1#top'), 'otter');
  assert.equal(extractSlug('  Otter '), 'otter');
});
