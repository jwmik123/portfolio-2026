/**
 * The site's own background — the swirling pattern plus the hero type, riding
 * the fluid field. It is rendered once into its own target so the black hole
 * pass can resample it along bent light paths without paying for the pattern
 * eight times over. That resampling is the whole point: the page itself wraps
 * around the rim, rather than a separate overlay being drawn on top of it.
 */

import { Color } from "three/webgpu";
import {
  Fn,
  clamp,
  cos,
  float,
  fract,
  min,
  mix,
  sin,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";

import { hash12 } from "@/lib/fluidNodes";

const PATTERN_STEPS = 8;

export function createSiteUniforms(fluidTexture, textTexture) {
  return {
    fluid: texture(fluidTexture),
    text: texture(textTexture),
    resolution: uniform(vec2(1, 1)),

    distortion: uniform(0.7),
    colorA: uniform(new Color("#060607")),
    colorB: uniform(new Color("#3a3a40")),
    colorC: uniform(new Color("#060607")),
    colorD: uniform(new Color("#3a3a40")),
    intensity: uniform(1.0),
    softness: uniform(1.0),
    noise: uniform(0.015),
  };
}

export function siteBackgroundNode(U) {
  // Wrapped in Fn: the pattern accumulates into mutable vars.
  return Fn(() => {
    const coords = uv();
    const fragCoord = coords.mul(U.resolution);
    const velocity = U.fluid.sample(coords).xy;

    // the type rides the fluid
    const typeUv = coords.add(velocity.mul(U.distortion.mul(0.3)));
    const type = U.text.sample(typeUv);

    // the pattern lives in square, centred coordinates
    const shortest = min(U.resolution.x, U.resolution.y);
    const p = fragCoord
      .mul(2.0)
      .sub(U.resolution)
      .div(shortest)
      .add(velocity.mul(U.distortion.mul(0.5)));

    // The original ran on performance.now() * 0.0005: half of real seconds.
    const t = time.mul(0.5);

    const d = t.mul(-0.5).toVar();
    const a = float(0).toVar();
    for (let i = 0; i < PATTERN_STEPS; i++) {
      a.addAssign(cos(float(i).sub(d).sub(a.mul(p.x))));
      d.addAssign(sin(p.y.mul(float(i)).add(a)));
    }
    d.addAssign(t.mul(0.5));

    const smoothing = clamp(U.softness.mul(0.1), 0.0, 0.9);
    const m1 = mix(cos(p.x.mul(d)).mul(0.5).add(0.5), 0.5, smoothing);
    const m2 = mix(cos(p.y.mul(a)).mul(0.5).add(0.5), 0.5, smoothing);
    const m3 = mix(sin(d.add(a)).mul(0.5).add(0.5), 0.5, smoothing);

    const pattern = mix(U.colorA, U.colorB, m1);
    const withC = mix(pattern, U.colorC, m2);
    const withD = mix(withC, U.colorD, m3.mul(0.4)).mul(U.intensity);

    const grain = hash12(fragCoord.add(fract(t.mul(100.0))))
      .mul(2.0)
      .sub(1.0)
      .mul(U.noise);

    return vec4(mix(withD.add(grain), type.rgb, type.a), 1.0);
  })();
}
