/**
 * The phonetic matcher is what makes street suggestions work in Cyprus at all.
 *
 * Almost nobody types Greek into a search box on a phone here; they type
 * "neas sinikias" and expect Νέας Συνοικίας. A regression in this file does not
 * break loudly - it just quietly returns no suggestions, and the feature looks
 * like it was never built. Hence the real street names below rather than
 * invented ones.
 */

import { describe, it, expect } from 'vitest';
import { phoneticKey, matchesName } from '../../src/utils/greeklish.js';

describe('phoneticKey', () => {
  it('collapses every Greek spelling of /i/ to the same letter', () => {
    // η, ι, υ, ει, οι all sound identical and are all typed as "i".
    expect(phoneticKey('Συνοικίας')).toBe('sinikias');
    expect(phoneticKey('sinikias')).toBe('sinikias');
    expect(phoneticKey('synoikias')).toBe('sinikias');
  });

  it('ignores accents, case and punctuation', () => {
    expect(phoneticKey('Ελλάδος')).toBe(phoneticKey('ελλαδος'));
    expect(phoneticKey('Αγ. Αντωνίου')).toBe(phoneticKey('Αγ Αντωνίου'));
  });

  it('treats a doubled letter as one sound', () => {
    expect(phoneticKey('Ελλάδος')).toBe(phoneticKey('elados'));
  });

  it('returns empty for rubbish rather than throwing', () => {
    for (const input of [null, undefined, '', 42, {}]) {
      expect(phoneticKey(input)).toBe('');
    }
  });
});

describe('matchesName', () => {
  const cases = [
    ['Νέας Συνοικίας', 'neas sinikias'],
    ['Νέας Συνοικίας', 'sinikias'],
    ['Νέας Συνοικίας', 'synoikias'],
    ['Ποσειδώνος', 'posidonos'],
    ['Ποσειδώνος', 'poseidonos'],
    ['Αποστόλου Παύλου', 'apostolou'],
    ['Αποστόλου Παύλου', 'pavlou'],
    ['Λεωφόρος Τάφων των Βασιλέων', 'tafon']
  ];

  it.each(cases)('finds %s from "%s"', (name, query) => {
    expect(matchesName(name, query)).toBe(true);
  });

  it('accepts both the letter-faithful and the phonetic spelling of ντ', () => {
    // A Latin keyboard types "antoniou"; Greek phonetics say "adoniou".
    expect(matchesName('Αγίου Αντωνίου', 'antoniou')).toBe(true);
    expect(matchesName('Αγίου Αντωνίου', 'adoniou')).toBe(true);
  });

  it('matches on any word, so a surname finds the street', () => {
    expect(matchesName('Αποστόλου Παύλου', 'pavlou')).toBe(true);
  });

  it('does not match letters buried mid-word', () => {
    // Otherwise typing three letters offers half the city.
    expect(matchesName('Νέας Συνοικίας', 'kias')).toBe(false);
  });

  it('does not match an empty query', () => {
    expect(matchesName('Ποσειδώνος', '')).toBe(false);
    expect(matchesName('Ποσειδώνος', '   ')).toBe(false);
  });
});
