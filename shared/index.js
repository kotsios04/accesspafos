/**
 * AccessPafos AI - shared domain core.
 *
 * Every module here is pure, dependency-free ES module code that runs
 * unchanged in the browser bundle, in Cloud Functions and in unit tests.
 * That is deliberate: the score the map shows and the score the backend
 * computes must come from exactly the same lines of code.
 */

export * from './constants.js';
export * from './config.js';
export * from './geo.js';
export * from './osm.js';
export * from './observationSchema.js';
export * from './aggregate.js';
export * from './scoring.js';
export * from './confidence.js';
export * from './freshness.js';
export * from './classify.js';
export * from './assess.js';
export * from './routingCost.js';
export * from './astar.js';
export * from './route.js';
export * from './priority.js';
export * from './duplicates.js';
