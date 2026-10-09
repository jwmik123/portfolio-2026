/**
 * The page is a print in a developing tray: it already lies under a sheet of
 * water, so the intro is the image coming up in it.
 *
 * Development is a reaction at the paper's surface, and how fast it runs
 * depends on how fresh the developer there is. Still developer goes stale
 * against the emulsion, so development is slow; developer that flows across
 * the paper is replaced continually, so development is fast. That is why
 * prints are agitated, and why one comes up first where the tray was rocked.
 * Here a single drop does the agitating: its rings are the flow.
 *
 * For a travelling wave in shallow water the flow under it is proportional to
 * the height of the wave, crest or trough alike, so |h| is the flow. The
 * exchange can't run faster than the chemistry, so the rate saturates: the
 * crater under the drop comes up quickly, but not as a blown-out disc.
 *
 * This pass only accumulates development (x), stepped like the water and
 * ping-ponged at its resolution. The site pass turns it into density.
 */

import { Fn, abs, exp, float, texture, uniform, uv, vec4 } from "three/tsl";

export function createDevelopUniforms(previousTexture, waterTexture) {
  return {
    previous: texture(previousTexture),
    water: texture(waterTexture),
    /** seconds since the last step */
    dt: uniform(0),
    /** development per second in still developer */
    still: uniform(0.1),
    /** extra development per second in fully refreshed developer */
    flow: uniform(14),
    /** wave height at which the exchange is 63% of the way to its limit */
    saturation: uniform(0.03),
  };
}

export function developStepNode(U) {
  return Fn(() => {
    const st = uv();
    const before = U.previous.sample(st).x;
    const flowing = abs(U.water.sample(st).x);
    const refreshed = float(1.0).sub(exp(flowing.div(U.saturation).negate()));
    const rate = U.still.add(U.flow.mul(refreshed));
    return vec4(before.add(rate.mul(U.dt)), 0.0, 0.0, 1.0);
  })();
}

/**
 * Density from development. Developing is two first-order steps in series —
 * the developer reaching a grain, then reducing it — so density follows the
 * gamma distribution's CDF for k = 2: an induction period with no image at
 * all, a steady rise, and a long approach to full density. Its slope is zero
 * at the start, so the image never snaps on.
 */
export const density = (developed) =>
  float(1.0).sub(developed.add(1.0).mul(exp(developed.negate())));
