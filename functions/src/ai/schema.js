/**
 * Zod schema for the model's structured output.
 *
 * This is the contract at the model boundary. Genkit uses it to constrain
 * generation and to reject a malformed response before it reaches any of our
 * logic. `shared/observationSchema.js` then normalises and re-validates the
 * result, so a model that finds a way around the constraint still cannot
 * inject an unknown value into the pipeline.
 *
 * The vocabulary here is intentionally identical to the shared ENUMS; the
 * test suite asserts that the two stay in step.
 */

import { z } from 'genkit';
import { ENUMS } from '../shared/observationSchema.js';

const enumOf = (values) => z.enum(/** @type {[string, ...string[]]} */ (values));

export const StreetAccessibilityObservationSchema = z.object({
  imageQuality: enumOf(ENUMS.imageQuality)
    .describe('Whether the photograph is clear enough to judge the pedestrian environment at all.'),

  pedestrianPath: z.object({
    visible: enumOf(ENUMS.visibility)
      .describe('Is a pedestrian path, pavement or walkable surface visible? Use "not_visible" when the view is obstructed, "no" only when you can see there is none.'),
    condition: enumOf(ENUMS.pathCondition)
      .describe('Is that path clear to walk along, narrowed by something, or fully blocked?')
  }),

  curbRamp: z.object({
    visible: enumOf(ENUMS.visibility)
      .describe('Is a dropped kerb or curb ramp visible where the pavement meets the road? "no" means you can see the kerb and there is no ramp.'),
    condition: enumOf(ENUMS.rampCondition)
      .describe('If a ramp is visible, is it usable or damaged?')
  }),

  stairs: z.object({
    visible: enumOf(ENUMS.visibility)
      .describe('Are steps or stairs visible on the pedestrian route?')
  }),

  surface: z.object({
    type: enumOf(ENUMS.surfaceType).describe('Material of the walking surface.'),
    condition: enumOf(ENUMS.surfaceCondition).describe('Condition of the walking surface.')
  }),

  obstacle: z.object({
    visible: enumOf(ENUMS.visibility)
      .describe('Is anything standing on the pedestrian path: bollards, parked vehicles, bins, signage, café furniture, building materials?'),
    severity: enumOf(ENUMS.obstacleSeverity)
      .describe('How much of the path it takes: none, minor, moderate, or blocking (impassable in a wheelchair).'),
    description: z.string().max(140)
      .describe('A few words naming the obstacle. Empty string when there is none. Never describe people.')
  }),

  crossing: z.object({
    visible: enumOf(ENUMS.visibility).describe('Is a road crossing visible?'),
    accessibleFeatures: z.array(enumOf(ENUMS.crossingFeature))
      .describe('Only features you can actually see at that crossing.')
  }),

  clearPassage: z.object({
    classification: enumOf(ENUMS.passage)
      .describe('Overall: could a wheelchair user get past along this pedestrian route in this view?')
  }),

  uncertainFindings: z.array(z.string().max(120)).max(6)
    .describe('Things you suspect but cannot confirm from this image. Prefer listing them here over guessing above.'),

  notes: z.string().max(240)
    .describe('One short factual sentence about the pedestrian environment. No speculation, no advice.')
});

/** @typedef {z.infer<typeof StreetAccessibilityObservationSchema>} StreetAccessibilityObservation */
