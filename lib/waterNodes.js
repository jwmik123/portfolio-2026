/**
 * The page sits under a shallow sheet of water. The surface is a height field
 * stepped with the discrete wave equation, ping-ponged between two float
 * targets: x holds the height now, y the height one step ago, so the next
 * step is a Verlet update and needs nothing else.
 *
 * The pointer is a finger dragged through the sheet. It presses the surface
 * down along the path it travelled since the last frame; ripples spread out
 * from that wake, reflect off the screen edges and die away. A pointer that
 * has stopped presses nothing, so the water stills under it.
 *
 * Nothing is drawn from this field. The site pass only reads its slope and
 * looks at the page through it — see throughWater.
 */

import {
  Fn,
  clamp,
  dot,
  float,
  length,
  max,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";

export function createWaterUniforms(previousTexture) {
  return {
    previous: texture(previousTexture),
    /** the simulation's own size, in its pixels */
    resolution: uniform(vec2(1, 1)),
    /**
     * x,y = pointer now, z,w = pointer last frame, in simulation pixels, y
     * down like the screen
     */
    pointer: uniform(vec4(0, 0, 0, 0)),
    /** how hard the pointer presses this step, 0 when it has not moved */
    push: uniform(0),

    /** brush radius, in simulation pixels */
    radius: uniform(16),
    strength: uniform(1),
    /**
     * c^2 of the wave equation, in texels per step. The explicit scheme is
     * only stable up to 0.5 on a 2D grid.
     */
    waveSpeed: uniform(0.4),
    /** fraction of the surface's motion kept per step */
    damping: uniform(0.994),
  };
}

/** Distance from p to the segment a-b. */
const segmentDistance = /*@__PURE__*/ Fn(([p, a, b]) => {
  const pa = p.sub(a);
  const ba = b.sub(a);
  const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0.0, 1.0);
  return length(pa.sub(ba.mul(h)));
});

export function waterStepNode(U) {
  return Fn(() => {
    const st = uv();
    const texel = vec2(1).div(U.resolution);

    // Samples past the edge clamp to it, which makes the screen's border a
    // wall: ripples reflect off it instead of wrapping round to the far side.
    const here = U.previous.sample(st);
    const height = here.x;
    const before = here.y;
    const laplacian = U.previous
      .sample(st.add(vec2(texel.x, 0)))
      .x.add(U.previous.sample(st.sub(vec2(texel.x, 0))).x)
      .add(U.previous.sample(st.add(vec2(0, texel.y))).x)
      .add(U.previous.sample(st.sub(vec2(0, texel.y))).x)
      .sub(height.mul(4.0));

    const next = height
      .add(height.sub(before).mul(U.damping))
      .add(laplacian.mul(U.waveSpeed))
      .toVar();

    // The finger's footprint is (1 - x^2)^2: flat under the centre of the
    // fingertip and meeting still water with no slope, so the press itself
    // never draws a rim into the surface.
    const d = segmentDistance(st.mul(U.resolution), U.pointer.xy, U.pointer.zw)
      .div(U.radius);
    const footprint = clamp(float(1.0).sub(d.mul(d)), 0.0, 1.0);
    next.subAssign(footprint.mul(footprint).mul(U.strength).mul(U.push));

    return vec4(next, height, 0.0, 1.0);
  })();
}

/**
 * What the water does to the page beneath it, seen straight down.
 *
 * A ray through a tilted patch of surface bends towards the higher side, so
 * the page shows up shifted up the slope: by the slope times the depth times
 * (1 - 1/n), all of which folds into `refraction`, in screen px per unit of
 * slope. Rays bend towards crests and away from troughs, so the same bending
 * that shifts the page also gathers light under every crest and spreads it
 * under every trough. Light landing on the page is scaled by the inverse of
 * how much the bending stretches an area there, which for a shallow sheet is
 * 1 / (1 + depth * curvature): `caustics` stands in for that depth. That is
 * what makes the ripples visible on smooth cloth, where a shift alone shows
 * nothing.
 *
 * Returns `offset`, in screen px, and `light`, the factor on the light that
 * reaches the page.
 */
export function throughWater(water, coords, refraction, caustics) {
  const size = vec2(water.size(0));
  const texel = vec2(1).div(size);
  const here = water.sample(coords).x;
  const east = water.sample(coords.add(vec2(texel.x, 0))).x;
  const west = water.sample(coords.sub(vec2(texel.x, 0))).x;
  const north = water.sample(coords.add(vec2(0, texel.y))).x;
  const south = water.sample(coords.sub(vec2(0, texel.y))).x;

  const slope = vec2(east.sub(west), north.sub(south)).mul(0.5);
  const curvature = east.add(west).add(north).add(south).sub(here.mul(4.0));

  // Past a stretch of 0.4 the sheet would be focusing light to a point, which
  // a sheet this shallow never gets near; the floor only keeps a freak
  // impulse from dividing by zero.
  const stretch = max(float(1.0).add(curvature.mul(caustics)), 0.4);

  return { offset: slope.mul(refraction), light: float(1.0).div(stretch) };
}
