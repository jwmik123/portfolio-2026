/**
 * The site's own background — a sheet of satin with the hero type printed on
 * it, seen through the water surface. It is rendered once into its own target
 * so the black hole pass can resample it along bent light paths without paying
 * for the pattern eight times over. That resampling is the whole point: the
 * page itself wraps around the rim, rather than a separate overlay being drawn
 * on top of it.
 */

import { Color, Vector2 } from "three/webgpu";
import {
  Fn,
  clamp,
  cos,
  dot,
  float,
  fract,
  length,
  max,
  min,
  mix,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import { density } from "@/lib/developNodes";
import { throughWater } from "@/lib/waterNodes";

const PATTERN_STEPS = 8;
const LUMA = vec3(0.2126, 0.7152, 0.0722);

const hash12 = /*@__PURE__*/ Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});

export function createSiteUniforms(
  waterTexture,
  textTexture,
  foldTexture,
  developTexture
) {
  return {
    water: texture(waterTexture),
    /** how far the print has developed — see lib/developNodes.js */
    developed: texture(developTexture),
    /** 1 once the print is fully developed and the tray is put away */
    finished: uniform(0),
    text: texture(textTexture),
    /** the cloth's light at low resolution — see foldNode */
    fold: texture(foldTexture),
    resolution: uniform(vec2(1, 1)),

    /** screen pixels the page shifts per unit of surface slope */
    refraction: uniform(10),
    /** depth of the sheet for its caustics, in simulation px */
    caustics: uniform(8),
    colorA: uniform(new Color("#060607")),
    colorB: uniform(new Color("#3a3a40")),
    colorC: uniform(new Color("#060607")),
    colorD: uniform(new Color("#3a3a40")),
    intensity: uniform(1.0),
    softness: uniform(1.0),
    noise: uniform(0.015),

    /**
     * The print. Its reflectance is what the ink gives back under full
     * light; `ambient` is the share of light that still reaches the deepest
     * fold, so the type never sinks into the cloth entirely.
     */
    ink: uniform(0.85),
    ambient: uniform(0.4),
    /** screen-space direction the light comes from, y down */
    light: uniform(new Vector2(-0.6, -0.8).normalize()),
    /** px the print shifts where the cloth tilts furthest */
    drape: uniform(6),
    /** px over which the drape is averaged: how wide a fold bends the print */
    drapeSpan: uniform(14),

    /**
     * The intro's falling drop — see dropNode. Its radius is how big it
     * looks, so it shrinks as it falls away from the eye; 0 means no drop.
     */
    dropCenter: uniform(new Vector2(0, 0)),
    dropRadius: uniform(0),
  };
}

/** The time base for the pattern and the grain. */
const patternTime = () => time.mul(0.5);

/**
 * The satin at a screen position, in CSS pixels: its colour, and how much
 * light that patch of cloth is catching.
 *
 * The pattern reads as satin because its brightness behaves like light on
 * folds. Take it as exactly that: the cloth's albedo is its darkest colour,
 * so how far a pixel sits between the darkest and the brightest colour is how
 * lit it is.
 */
const satin = (U, at) => {
  // the pattern lives in square, centred coordinates, y up as it was drawn;
  // the page is addressed y down
  const shortest = min(U.resolution.x, U.resolution.y);
  const p = at.mul(2.0).sub(U.resolution).div(shortest).mul(vec2(1.0, -1.0));

  // The original ran on performance.now() * 0.0005: half of real seconds.
  const t = patternTime();

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
  const cloth = mix(withC, U.colorD, m3.mul(0.4)).mul(U.intensity);

  const dark = dot(U.colorA, LUMA).mul(U.intensity);
  const bright = dot(U.colorB, LUMA).mul(U.intensity);
  const shade = clamp(
    dot(cloth, LUMA).sub(dark).div(bright.sub(dark)),
    0.0,
    1.0
  );

  return { cloth, shade };
};

/**
 * The cloth's light alone, rendered at a fraction of the screen's resolution.
 * The print is bent by the folds' tilt, and the pattern has creases sharp
 * enough that taking the tilt pixel by pixel tears the letters along them.
 * Real print bends across the whole width of a fold, so the drape is read from
 * this coarse copy, which the site pass blurs a little further.
 */
export function foldNode(U) {
  return Fn(() => {
    const { shade } = satin(U, uv().mul(U.resolution));
    return vec4(shade, 0.0, 0.0, 1.0);
  })();
}

/**
 * The intro's drop: a white dot over the black page, nothing more. Its edge
 * is a pixel of anti-aliasing, so it stays a crisp point at every size.
 */
const dropNode = (U, fragCoord, below) => {
  const distance = length(fragCoord.sub(U.dropCenter));
  const cover = float(1.0)
    .sub(smoothstep(U.dropRadius.sub(0.5), U.dropRadius.add(0.5), distance))
    .mul(U.dropRadius.greaterThan(0.0).select(1.0, 0.0));
  return mix(below, vec3(1.0), cover);
};

export function siteBackgroundNode(U) {
  // Wrapped in Fn: the pattern accumulates into mutable vars.
  return Fn(() => {
    const coords = uv();
    const fragCoord = coords.mul(U.resolution);

    // Everything below the surface is bent by the same amount, the pattern
    // and the type alike: it is one page under one sheet of water.
    const water = throughWater(U.water, coords, U.refraction, U.caustics);
    const bent = fragCoord.add(water.offset);
    const { cloth, shade } = satin(U, bent);

    /*
     * Lit like that, a patch's shade is how far it faces the light: mid-grey
     * is flat, either side is a fold tilting towards or away from it. Print
     * on a tilted patch is foreshortened, so the type slides along the light
     * by the tilt — the same folds that shade it bend it. The tilt is taken
     * over the width of a fold (four taps of the coarse copy), so the bend
     * and its rate of change both ease in and out instead of kinking.
     */
    const span = U.drapeSpan.div(U.resolution);
    const foldAt = (dx, dy) =>
      U.fold.sample(bent.div(U.resolution).add(span.mul(vec2(dx, dy)))).x;
    const tilt = foldAt(1, 1)
      .add(foldAt(-1, 1))
      .add(foldAt(1, -1))
      .add(foldAt(-1, -1))
      .mul(0.25)
      .sub(0.5)
      .mul(2.0);
    const drape = U.light.mul(tilt.mul(U.drape));
    const type = U.text.sample(bent.add(drape).div(U.resolution));

    // The ink catches the same light as the cloth around it, so a fold that
    // darkens the satin darkens the letters on it too.
    const ink = vec3(U.ink.mul(mix(U.ambient, 1.0, shade)));
    // Undeveloped paper is the cloth's albedo, its darkest colour; each tone
    // comes up out of it in proportion, so the brightest — the type — crosses
    // into sight first and the satin follows. Development happened on the
    // paper, so it is read where the paper is, through the water.
    const developed = max(
      density(U.developed.sample(bent.div(U.resolution)).x),
      U.finished
    );
    const paper = U.colorA.mul(U.intensity);
    const image = mix(paper, mix(cloth, ink, type.a), developed);
    // Everything on the page is lit through the water, cloth and ink alike.
    const printed = dropNode(U, fragCoord, image.mul(water.light));

    // The grain is the film over everything, the type included, so it is
    // added last: type without it is what made it read as pasted on. It is
    // the emulsion's own silver, so it forms where the print develops and
    // nowhere else: blank paper has none, and it comes in with the ripple.
    const grain = hash12(fragCoord.add(fract(patternTime().mul(100.0))))
      .mul(2.0)
      .sub(1.0)
      .mul(U.noise)
      .mul(developed);

    return vec4(printed.add(grain), 1.0);
  })();
}
