/**
 * The site's fluid field, ported from the original GLSL to TSL so it can live
 * in the same WebGPU pipeline as the black hole. Ping-ponged between two
 * half-float render targets: each frame advects the previous one along its own
 * velocity, relaxes it, and injects whatever the pointer did.
 *
 * Channels: xy = velocity, z = trail / pressure, w = brush accumulation.
 */

import {
  Fn,
  clamp,
  dot,
  exp,
  float,
  fract,
  length,
  max,
  min,
  mix,
  pow,
  sin,
  sqrt,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

const ADVECTION_STEPS = 8;

export function createFluidUniforms(previousTexture) {
  return {
    previous: texture(previousTexture),
    resolution: uniform(vec2(1, 1)),
    /** x,y = pointer now, z,w = pointer last frame, in pixels */
    pointer: uniform(vec4(0, 0, 0, 0)),
    pointerActive: uniform(0),

    brushSize: uniform(25.0),
    brushStrength: uniform(0.3),
    fluidDecay: uniform(0.98),
    trailLength: uniform(0.8),
    stopDecay: uniform(0.85),
  };
}

/** Area of a triangle, via Heron. Guarded so float error can't produce NaN. */
const triangleArea = /*@__PURE__*/ Fn(([a, b, c]) => {
  const ab = length(b.sub(c));
  const bc = length(c.sub(a));
  const ca = length(a.sub(b));
  const s = ab.add(bc).add(ca).mul(0.5);
  const inner = s.mul(s.sub(ab)).mul(s.sub(bc)).mul(s.sub(ca));
  return sqrt(max(inner, 0.0));
});

/** Distance from p to the segment a-b. */
const segmentDistance = /*@__PURE__*/ Fn(([p, a, b]) => {
  const pa = p.sub(a);
  const ba = b.sub(a);
  const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0.0, 1.0);
  return length(pa.sub(ba.mul(h)));
});

/** Seeds the very first frame; the simulation needs something to chew on. */
export function fluidSeedNode(U) {
  const position = uv().mul(U.resolution);
  const w = sin(position.x.mul(0.2)).mul(0.5).add(0.5);
  const q = length(position.sub(U.resolution.mul(0.5)));
  return vec4(exp(q.mul(q).mul(-0.001)).mul(0.1), 0.0, 0.0, w);
}

export function fluidStepNode(U) {
  // Wrapped in Fn: the advection walk uses mutable vars, which TSL only
  // allows inside a function scope.
  return Fn(() => {
    const res = U.resolution;
    const position = uv().mul(res);

    const at = (p) => U.previous.sample(fract(p.div(res)));
    const atOffset = (p, x, y) => at(p.add(vec2(x, y)));

    // Walk every sample point back along the velocity field.
    const v = position.toVar();
    const a = position.add(vec2(1, 1)).toVar();
    const b = position.add(vec2(1, -1)).toVar();
    const c = position.add(vec2(-1, 1)).toVar();
    const d = position.add(vec2(-1, -1)).toVar();

    for (let i = 0; i < ADVECTION_STEPS; i++) {
      v.subAssign(at(v).xy);
      a.subAssign(at(a).xy);
      b.subAssign(at(b).xy);
      c.subAssign(at(c).xy);
      d.subAssign(at(d).xy);
    }

    const here = at(v);
    const north = atOffset(v, 0, 1);
    const east = atOffset(v, 1, 0);
    const south = atOffset(v, 0, -1);
    const west = atOffset(v, -1, 0);
    const neighbours = north.add(east).add(south).add(west).mul(0.25);

    // Relax towards the neighbourhood, hard on z (pressure), not at all on w.
    const relaxed = mix(here, neighbours, vec4(0.15, 0.15, 0.95, 0.0));

    // Divergence from how much the four corners spread apart while advecting.
    const spread = triangleArea(a, b, c)
      .add(triangleArea(b, c, d))
      .sub(4.0);
    const pressure = relaxed.z.sub(spread.mul(0.01));

    // Push velocity down the pressure gradient.
    const gradient = vec2(east.z.sub(west.z), north.z.sub(south.z));
    const velocity = relaxed.xy
      .add(gradient.mul(100.0).div(res))
      .mul(U.fluidDecay);

    const trail = pressure.mul(U.trailLength);

    /* ---- pointer injection ------------------------------------------ */

    const now = U.pointer.xy;
    const previous = U.pointer.zw;
    const travel = now.sub(previous);
    const speed = length(travel);
    const stroke = travel.div(max(speed, 1e-6)).mul(min(speed, 10.0));

    const distance = segmentDistance(position, now, previous);
    const falloff = pow(
      exp(
        distance.mul(distance).mul(distance).mul(float(-1e-4).div(U.brushSize)),
      ),
      0.5,
    );
    const brush = falloff.mul(U.brushStrength.mul(0.03)).mul(U.pointerActive);

    // A pointer that has stopped bleeds the field off instead of feeding it.
    const influence = exp(length(position.sub(now)).mul(-0.01));
    const resting = step(speed, 2.0).mul(U.pointerActive);
    const decay = mix(
      float(1.0),
      mix(float(1.0), U.stopDecay, influence),
      resting,
    );

    const outVelocity = velocity.add(stroke.mul(brush)).mul(decay);
    const outTrail = trail.mul(decay);
    const outBrush = relaxed.w.add(brush.mul(10.0));

    return clamp(vec4(outVelocity, outTrail, outBrush), -0.4, 0.4);
  })();
}

/** Exported for the background pass, which uses the same noise. */
export const hash12 = /*@__PURE__*/ Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});
