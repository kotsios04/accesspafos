/**
 * The id parser is the part of the Mapillary integration that can fail
 * silently and expensively.
 *
 * Everything else either works or visibly does not: a failed request renders
 * "no photograph", a missing token renders nothing at all. But a viewer URL
 * parsed into the *wrong* id fetches a real photograph of a different street
 * and puts it underneath an assessment as evidence. That is worse than showing
 * nothing, so the rule is that anything not unambiguously an id returns null.
 */

import { describe, it, expect } from 'vitest';
import { imageIdFromViewerUrl } from '../../src/services/mapillary.js';

describe('imageIdFromViewerUrl', () => {
  it('reads the pKey form the ingestion pipeline writes', () => {
    expect(imageIdFromViewerUrl(
      'https://www.mapillary.com/app/?pKey=930905001288646&focus=photo'
    )).toBe('930905001288646');
  });

  it('reads the short /im/ form', () => {
    expect(imageIdFromViewerUrl('https://www.mapillary.com/im/930905001288646'))
      .toBe('930905001288646');
  });

  it('ignores the order and presence of other query parameters', () => {
    expect(imageIdFromViewerUrl(
      'https://www.mapillary.com/app/?lat=34.75&pKey=123&lng=32.41&z=17'
    )).toBe('123');
  });

  it('refuses a host that is not Mapillary', () => {
    // A look-alike domain must not get us to fetch on its behalf, and an id
    // taken from one is not an id we have any reason to trust.
    expect(imageIdFromViewerUrl('https://mapillary.com.evil.test/app/?pKey=123')).toBeNull();
    expect(imageIdFromViewerUrl('https://example.com/app/?pKey=123')).toBeNull();
  });

  it('accepts subdomains of mapillary.com', () => {
    expect(imageIdFromViewerUrl('https://www.mapillary.com/app/?pKey=9')).toBe('9');
    expect(imageIdFromViewerUrl('https://mapillary.com/app/?pKey=9')).toBe('9');
  });

  it('refuses an id that is not numeric', () => {
    expect(imageIdFromViewerUrl('https://www.mapillary.com/app/?pKey=../../secret')).toBeNull();
    expect(imageIdFromViewerUrl('https://www.mapillary.com/app/?pKey=abc')).toBeNull();
  });

  it('returns null for a URL with no image in it', () => {
    expect(imageIdFromViewerUrl('https://www.mapillary.com/app/')).toBeNull();
  });

  it('returns null rather than throwing on rubbish input', () => {
    for (const input of [null, undefined, '', 42, {}, 'not a url']) {
      expect(imageIdFromViewerUrl(input)).toBeNull();
    }
  });
});
