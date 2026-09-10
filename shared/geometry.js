/**
 * Firestore-safe geometry encoding.
 *
 * A LineString is naturally `[[lng, lat], [lng, lat], ...]`, and Firestore
 * rejects that outright: "Nested arrays are not allowed". The whole OSM import
 * failed on this after parsing all 5,697 segments correctly, because the dry
 * run never reached a write and so never met the constraint.
 *
 * Coordinates are therefore stored flat - `[lng, lat, lng, lat, ...]` - and
 * unpacked on the way out. A flat array of numbers is the cheapest honest
 * encoding available: half the document overhead of an array of maps, and
 * unlike an encoded string it stays readable in the Firestore console.
 *
 * Both functions accept either shape and return the one they promise, so a
 * document written before this change, or a test fixture holding the natural
 * nested form, keeps working.
 */

/** `[[lng,lat],...]` (or already-flat) -> `[lng,lat,lng,lat,...]` */
export function packGeometry(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return [];
  if (typeof coordinates[0] === 'number') return coordinates.slice();

  const flat = [];
  for (const point of coordinates) {
    if (!Array.isArray(point) || point.length < 2) continue;
    flat.push(Number(point[0]), Number(point[1]));
  }
  return flat;
}

/** `[lng,lat,lng,lat,...]` (or already-nested) -> `[[lng,lat],...]` */
export function unpackGeometry(flat) {
  if (!Array.isArray(flat) || flat.length === 0) return [];
  if (Array.isArray(flat[0])) return flat;

  const points = [];
  for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i], flat[i + 1]]);
  return points;
}

/** Read a segment document back into the shape the rest of the code expects. */
export function decodeSegment(data) {
  if (!data) return data;
  return { ...data, geometry: unpackGeometry(data.geometry) };
}
