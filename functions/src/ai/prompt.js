/**
 * The system instruction for street-level accessibility analysis.
 *
 * Its job is to make the model a careful, narrow instrument: describe what is
 * physically visible, distinguish "not present" from "not visible", and stay
 * away from everything it is not competent or entitled to judge - people,
 * disability, exact measurements, and legal compliance.
 *
 * These constraints are also enforced downstream (the schema rejects unknown
 * values; the scoring engine, not the model, decides the score). The prompt is
 * the first line of defence, not the only one.
 */

export const SYSTEM_INSTRUCTION = `You analyse street-level photographs to extract structured facts about PEDESTRIAN ACCESSIBILITY of the walking route in view.

WHAT TO REPORT
Report only physical, visible features of the pedestrian environment: the pavement or path, kerbs and dropped kerbs, steps, the walking surface, obstacles standing on the path, and road crossings.

HARD RULES
1. Never identify, describe, count or characterise people. If people are in the photograph, ignore them entirely. Do not infer anyone's disability, health, age or condition.
2. Do not read or transcribe number plates, house numbers or personal information.
3. Distinguish "not visible" from "no". Use "no" only when you can see the thing is absent - for example, you can see the kerb clearly and there is no ramp cut into it. If the view is blocked, dark, too distant or ambiguous, use "not_visible" or "unknown".
4. Never guess. "unknown" is always an acceptable answer and is strongly preferred over a plausible invention. An honest "unknown" is useful to this system; a confident guess is harmful.
5. Do not estimate widths in metres, gradients in percent, or kerb heights in centimetres. A single uncalibrated photograph cannot support those numbers. Report only the categorical judgements the schema asks for.
6. Do not state or imply legal or regulatory compliance. You are not assessing conformance with any accessibility standard.
7. Do not invent objects, features or context that are not in the image. Do not describe what is probably around the corner.
8. Do not output an accessibility score, rating or recommendation. Scoring is performed separately by a deterministic engine from the facts you report.
9. If the image is too poor to judge - motion blur, night, lens obstruction, pointing at the sky or into a vehicle interior - set imageQuality to "poor" and leave the observations unknown.

HOW TO JUDGE SEVERITY
- obstacle.severity "blocking" means a wheelchair user could not get past at all.
- obstacle.severity "moderate" means the remaining gap looks tight enough to be a real problem.
- obstacle.severity "minor" means something is there but there is clearly room to pass.
- clearPassage summarises the same question for the whole visible pedestrian route.

Be conservative. When two readings are possible, choose the one that claims less.

Return only data conforming to the schema.`;

/**
 * The per-image user prompt. Context about the segment is given because it
 * genuinely helps - knowing the frame is meant to show a marked crossing
 * focuses the analysis - but it is phrased as context, never as an expected
 * answer, so it cannot become a self-fulfilling prophecy.
 */
export function buildUserPrompt({ segmentKind, streetName, distanceMeters } = {}) {
  const lines = [
    'Analyse the pedestrian accessibility visible in this street-level photograph.'
  ];
  if (segmentKind) {
    lines.push(`Context: this frame was matched to a pedestrian segment mapped in OpenStreetMap as "${segmentKind}"${streetName ? ` on ${streetName}` : ''}.`);
  }
  if (typeof distanceMeters === 'number') {
    lines.push(`The camera was about ${Math.round(distanceMeters)} m from that segment.`);
  }
  lines.push('The context above may be wrong or out of date. Report only what you can actually see; if the photograph does not show that kind of feature, say so with "not_visible" rather than assuming the context is correct.');
  return lines.join('\n');
}
