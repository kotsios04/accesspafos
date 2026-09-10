/**
 * Matching Greek street names against what a Cypriot actually types.
 *
 * Somebody looking for Νέας Συνοικίας types "neas sinikias". Not a
 * transliteration - a phonetic one. Greek has six ways to spell /i/ and a
 * person typing on a Latin keyboard picks whichever their hand reaches first,
 * so `Συνοικίας` becomes "sinikias", "synoikias", "sinoikias" or "synikias"
 * depending on the day.
 *
 * Character-by-character transliteration cannot match any of that. So both the
 * street name and the query are reduced to the same phonetic skeleton, where
 * every spelling of a sound collapses to one letter, and the comparison happens
 * there. `Συνοικίας` and "sinikias" both become `sinikias`.
 *
 * This is not linguistics; it is a matching aid, and it is deliberately
 * over-eager. A suggestion list that offers one street too many costs a glance.
 * One that offers nothing, because the reader spelled a vowel the other way,
 * costs them the feature.
 */

/** Digraphs first: order matters, since 'ου' must not be seen as 'ο' + 'υ'. */
const DIGRAPHS = [
  ['αι', 'e'], ['ει', 'i'], ['οι', 'i'], ['υι', 'i'],
  ['ου', 'u'], ['αυ', 'av'], ['ευ', 'ev'], ['ηυ', 'iv'],
  ['μπ', 'b'], ['ντ', 'd'], ['γκ', 'g'], ['γγ', 'g'],
  ['τσ', 'ts'], ['τζ', 'tz']
];

const SINGLES = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th',
  ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p',
  ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'i', φ: 'f', χ: 'x', ψ: 'ps', ω: 'o'
};

/**
 * Latin spellings that stand for the same sound, applied to whichever side of
 * the comparison was typed on a Latin keyboard.
 */
const LATIN_FOLDS = [
  // The vowel digraphs Greek collapses must collapse on the Latin side too, or
  // the two skeletons never meet: `Συνοικίας` reduces to `sinikias`, so a
  // reader who typed the letters faithfully as "synoikias" has to arrive at
  // the same place.
  [/ai/g, 'e'], [/ei/g, 'i'], [/oi/g, 'i'], [/ui/g, 'i'], [/ou/g, 'u'],
  // Greek reads ντ, μπ and γκ as single sounds, but a Latin keyboard types
  // them letter by letter far more often than phonetically - "antoniou", not
  // "adoniou". Folding the same way here accepts both spellings, since the
  // Greek side has already collapsed them.
  [/nt/g, 'd'], [/mp/g, 'b'], [/gk/g, 'g'], [/ng/g, 'g'],
  [/ch/g, 'x'], [/kh/g, 'x'], [/ph/g, 'f'], [/gh/g, 'g'],
  [/ck/g, 'k'], [/qu/g, 'k'], [/q/g, 'k'], [/c/g, 'k'],
  [/y/g, 'i'], [/j/g, 'i'], [/w/g, 'v'], [/ee/g, 'i'], [/oo/g, 'u']
];

/**
 * Reduce a name or a query to the form both are compared in.
 * @param {string} value
 * @returns {string}
 */
export function phoneticKey(value) {
  if (typeof value !== 'string' || !value) return '';

  // Strip accents and diacritics: ά and α are the same letter for this purpose,
  // and nobody types the tonos when searching.
  let s = value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  for (const [from, to] of DIGRAPHS) s = s.split(from).join(to);
  s = [...s].map((ch) => SINGLES[ch] ?? ch).join('');
  for (const [pattern, to] of LATIN_FOLDS) s = s.replace(pattern, to);

  // 'th' survives the folds as a unit; everything else that is not a letter or
  // digit is separator noise.
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();

  // A doubled letter is a spelling choice, never a different sound.
  return s.replace(/([a-z])\1+/g, '$1');
}

/**
 * Does `query` look like the start of any word in `name`?
 *
 * Word-prefix rather than plain substring: typing "sin" should offer
 * Συνοικίας, but should not offer every street with those letters buried in
 * the middle of a longer word.
 *
 * @param {string} name   the street name, as stored
 * @param {string} query  what the reader typed
 */
export function matchesName(name, query) {
  const q = phoneticKey(query);
  if (!q) return false;
  const key = phoneticKey(name);
  if (!key) return false;
  if (key.startsWith(q)) return true;
  return key.split(' ').some((word) => word.startsWith(q));
}
