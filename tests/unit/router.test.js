/**
 * Router path handling.
 *
 * The base-path logic exists so the same build can be served from a
 * sub-directory during review without the router mistaking the directory
 * prefix for a route. In production BASE_URL is '/' and all of this is inert.
 */

import { describe, it, expect } from 'vitest';
import { route, match, toAppPath, toHref } from '@src/router/index.js';

route('/', () => Promise.resolve({}), {});
route('/map', () => Promise.resolve({}), {});
route('/segment/:id', () => Promise.resolve({}), {});
route('/admin/priorities', () => Promise.resolve({}), {});

describe('match()', () => {
  it('matches static routes with or without a trailing slash', () => {
    expect(match('/map')).not.toBeNull();
    expect(match('/map/')).not.toBeNull();
  });

  it('extracts and decodes path parameters', () => {
    expect(match('/segment/way%2F123').params.id).toBe('way/123');
  });

  it('returns null for an unknown path rather than falling back to home', () => {
    expect(match('/nope')).toBeNull();
  });
});

describe('base path handling', () => {
  // Vitest leaves BASE_URL at '/', which is also the production value.
  it('is an identity mapping when the app is served from the root', () => {
    expect(toAppPath('/map')).toBe('/map');
    expect(toHref('/map')).toBe('/map');
    expect(toAppPath('/')).toBe('/');
    expect(toHref('/')).toBe('/');
  });

  it('round-trips every registered path', () => {
    for (const path of ['/', '/map', '/segment/abc', '/admin/priorities']) {
      expect(toAppPath(toHref(path))).toBe(path);
    }
  });
});
