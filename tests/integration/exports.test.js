/**
 * CSV export correctness.
 *
 * Quoting is the part that silently corrupts a municipal spreadsheet, and
 * Greek street names full of commas are exactly the input that finds it.
 */

import { describe, it, expect } from 'vitest';
import { toCsv } from '../../functions/src/lib/csv.js';

const columns = [
  { key: 'priority', label: 'Priority' },
  { key: 'street', label: 'Street' },
  { label: 'Barriers', value: (row) => (row.barriers || []).join('; ') }
];

describe('toCsv', () => {
  it('writes a header from the labels', () => {
    expect(toCsv([], columns).split('\r\n')[0]).toBe('﻿Priority,Street,Barriers');
  });

  it('starts with a BOM so Excel reads Greek correctly', () => {
    expect(toCsv([{ street: 'Λεωφόρος Ποσειδώνος' }], columns).charCodeAt(0)).toBe(0xFEFF);
  });

  it('quotes values containing a comma', () => {
    const csv = toCsv([{ priority: 80, street: 'Poseidonos Avenue, Kato Pafos' }], columns);
    expect(csv).toContain('"Poseidonos Avenue, Kato Pafos"');
  });

  it('escapes embedded quotes by doubling them', () => {
    const csv = toCsv([{ street: 'The "Old" Harbour' }], columns);
    expect(csv).toContain('"The ""Old"" Harbour"');
  });

  it('quotes values containing a newline', () => {
    const csv = toCsv([{ street: 'Line one\nLine two' }], columns);
    expect(csv).toContain('"Line one\nLine two"');
  });

  it('writes an empty cell for null and undefined rather than the word "null"', () => {
    const csv = toCsv([{ priority: null, street: undefined }], columns);
    const row = csv.split('\r\n')[1];
    expect(row).toBe(',,');
  });

  it('supports computed columns', () => {
    const csv = toCsv([{ barriers: ['steps', 'missing_curb_ramp'] }], columns);
    expect(csv).toContain('steps; missing_curb_ramp');
  });

  it('uses CRLF line endings, as RFC 4180 requires', () => {
    const csv = toCsv([{ priority: 1 }, { priority: 2 }], columns);
    expect(csv.split('\r\n')).toHaveLength(4); // header + 2 rows + trailing
  });

  it('handles an empty or missing row set', () => {
    expect(() => toCsv(null, columns)).not.toThrow();
    expect(toCsv([], columns).split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});
