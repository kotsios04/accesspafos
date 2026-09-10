/**
 * The AI deduplication key.
 *
 * Its own module, with no dependencies, because it is the single most
 * cost-critical function in the system: it is what stops the same photograph
 * being paid for twice. Keeping it importable without pulling in Firebase
 * means it can be tested directly.
 *
 * The key deliberately includes the model and the analysis version. Changing
 * the prompt or the output schema bumps ANALYSIS_VERSION, which correctly
 * invalidates every cached observation rather than mixing results from two
 * different extraction contracts.
 */

/**
 * @param {{sourceType:string, sourceId:string|number, model:string, analysisVersion:string, sourceHash?:string|null}} input
 */
export function analysisDedupeKey({ sourceType, sourceId, model, analysisVersion, sourceHash = null }) {
  return [sourceType, sourceId, sourceHash || '-', model, analysisVersion].join('::');
}
