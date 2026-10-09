/**
 * The lens.
 *
 * Three things are happening at the rim, and they are deliberately separate:
 *
 *  1. The *page* refracts through it. Refraction displaces a sample in
 *     proportion to the slope of the surface it crosses, so the glass is
 *     written directly as a slope profile — a bump centred on the rim:
 *
 *         t    = (r - 1) / band
 *         s(r) = (1 - t^2)^2        on |t| < 1, exactly zero outside
 *         R    = r - bulge * s(r)
 *
 *     Both ends of that bump have zero value *and* zero derivative, so neither
 *     boundary is visible: the page beyond the band is pixel-for-pixel
 *     untouched. Strength is bulge/band; keep it under 0.65 and dR/dr stays
 *     positive, so the map never folds into a caustic ring.
 *
 *  2. The *shadow* is cut in bent space, not screen space. The glass therefore
 *     carries its own edge around with it instead of having a circle stamped
 *     on top, and because each channel is bent by a slightly different amount
 *     that edge splits into a prism fringe. A real dielectric disperses for
 *     exactly this reason: index of refraction varies with wavelength.
 *
 *  3. The *project* does none of this. It is behind the glass, not in it, so
 *     it is sampled straight and clipped well inside the rim. Bending the work
 *     itself would make it harder to read, which is the opposite of the point.
 */

import {
  Fn,
  abs,
  cos,
  float,
  fwidth,
  length,
  max,
  min,
  mix,
  oneMinus,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  positionLocal,
  positionWorld,
} from "three/tsl";

/** How many wave crests fit across the cloth, and how fast they travel. */
const CLOTH_FREQ = 7.5;
const CLOTH_SPEED = 11.0;
/** The scroll ripple runs along the strip instead of across it. */
const RIPPLE_FREQ = 2.0;
/** how strongly a ripple's slope darkens or lifts the sheet */
const RIPPLE_LIGHT = 0.2;

/** Radial taps. The map is smooth and monotonic, so three is plenty. */
const LENS_TAPS = 3;

/* ------------------------------------------------------------------ */
/* uniforms                                                            */
/* ------------------------------------------------------------------ */

export function createPortalUniforms() {
  return {
    /** rim radius, in half-viewport-heights. 0 = flat, the lens is a no-op. */
    radius: uniform(0.0),

    /**
     * Refraction strength, and how far the curvature reaches either side of
     * the rim. bulge / band must stay under 0.65 or the map folds.
     */
    bulge: uniform(0.0),
    band: uniform(0.38),

    /** how far apart the channels are bent — the prism fringe */
    disp: uniform(0.12),

    /** radial supersampling width, in pixels */
    aa: uniform(1.1),
  };
}

export function createPanelUniforms(initialTexture) {
  return {
    map: texture(initialTexture),
    /** panel half-extent, in rim radii */
    extent: uniform(1.0),
    /** half-width of the screenshot inside the panel, in rim radii */
    frame: uniform(0.95),
    /** the throat's radius in world units, used to clip the sheet */
    throat: uniform(1.0),
    /** strip v travelled per rim radius */
    vScale: uniform(0.2),
    /** strip v at the centre of the hole — this is the slider */
    vCenter: uniform(0.5),

    /** cloth amplitude envelope, 0 at rest */
    flap: uniform(0.0),
    /** travelling-wave phase, ramped linearly during a switch */
    phase: uniform(0.0),
    /** world-space displacement while flying in or out */
    shiftX: uniform(0.0),
    /** +1 switching forward, -1 switching back */
    dir: uniform(1.0),
    /** world units of cloth amplitude at full envelope */
    amp: uniform(0.3),
    opacity: uniform(1.0),

    /** scroll ripple envelope, 0 at rest; follows how fast the strip moves */
    ripple: uniform(0.0),
    /** advanced by scroll distance, so the wave is scrubbed, not timed */
    ripplePhase: uniform(0.0),
    /** -1..1, smoothed sign of the scroll: which edge leads */
    rippleDir: uniform(0.0),
  };
}

/* ------------------------------------------------------------------ */
/* the project panel: slider + cloth                                   */
/* ------------------------------------------------------------------ */

/**
 * `s` runs 0 -> 1 from the edge that leads the motion to the edge that
 * trails it, so the cloth always drags behind wherever it is heading.
 */
function clothCoords(U) {
  const coords = uv();
  const s = mix(oneMinus(coords.x), coords.x, step(0.0, U.dir));
  const phase = s.mul(CLOTH_FREQ).sub(U.phase.mul(CLOTH_SPEED));
  // amplitude grows towards the trailing edge, like a flag on a pole
  const amp = U.flap.mul(U.amp).mul(s.mul(s).mul(0.92).add(0.08));
  return { coords, s, phase, amp };
}

/**
 * The same cloth, dragged along its length. `s` runs from the edge leading the
 * scroll to the one trailing it; at rippleDir 0 it sits at 0.5 everywhere, so
 * a reversal passes through a flat bob instead of the wave jumping.
 */
function rippleCoords(U) {
  const coords = uv();
  const s = mix(oneMinus(coords.y), coords.y, U.rippleDir.mul(0.5).add(0.5));
  const phase = s.mul(RIPPLE_FREQ).sub(U.ripplePhase);
  const amp = U.ripple.mul(U.amp).mul(1.5).mul(s.mul(s).mul(0.85).add(0.15));
  return { coords, phase, amp };
}

export function panelPositionNode(U) {
  const { coords, s, phase, amp } = clothCoords(U);
  const ripple = rippleCoords(U);

  const primary = sin(phase).mul(amp);
  // a second wave across the other axis turns a ribbon into cloth
  const cross = sin(
    coords.y.mul(3.6).add(U.phase.mul(7.0)).add(s.mul(2.2))
  ).mul(amp.mul(0.6));
  // the sheet gathers vertically where it folds
  const gather = cos(phase).mul(amp.mul(0.3));

  const scrolled = sin(ripple.phase)
    .mul(ripple.amp)
    .add(
      sin(coords.x.mul(2.4).add(U.ripplePhase.mul(0.6))).mul(
        ripple.amp.mul(0.35)
      )
    );

  return positionLocal.add(
    vec3(U.shiftX, gather, primary.add(cross).add(scrolled))
  );
}

export function panelColorNode(U) {
  const { coords, phase } = clothCoords(U);

  // panel uv -> rim radii, centred on the hole
  const span = U.extent.mul(2.0);
  const cx = coords.x.sub(0.5).mul(span);
  const cy = coords.y.sub(0.5).mul(span);

  // The screenshot's width spans 2 * frame rim radii; everything else follows
  // from that one scale, so the strip never stretches.
  const tu = cx.div(U.frame.mul(2.0)).add(0.5);
  const tv = U.vCenter.add(cy.mul(U.vScale));

  const base = U.map.sample(vec2(tu, tv));

  // Outside the strip there is nothing — not a colour, an absence.
  const onStrip = smoothstep(0.0, 0.004, tu)
    .mul(smoothstep(1.0, 0.996, tu))
    .mul(smoothstep(0.0, 0.002, tv))
    .mul(smoothstep(1.0, 0.998, tv));

  // Clip the sheet to the throat — and do it in *world* space, not panel
  // space. The throat does not move; the sheets move behind it. So a sheet
  // flapping out of frame is eaten by the rim while the next one emerges from
  // it, and the hole is never empty mid-swap.
  const throat = smoothstep(
    1.0,
    0.985,
    length(positionWorld.xy).div(U.throat)
  );
  const inside = onStrip.mul(throat);

  // Shade from the wave slope instead of a light, so the fold reads as cloth.
  // The ripple is shaded by its own slope, d/ds of sin(phase) * amp, so the
  // light on the folds always matches how far the sheet actually bends.
  const ripple = rippleCoords(U);
  const shade = cos(phase)
    .mul(U.flap)
    .mul(0.7)
    .add(cos(ripple.phase).mul(ripple.amp).mul(RIPPLE_FREQ * RIPPLE_LIGHT))
    .add(1.0);

  // base.a carries the strip's own coverage: the runs above the first
  // screenshot and below the last are empty, so the page shows through there
  // rather than a black cap appearing inside the glass.
  return vec4(base.rgb.mul(shade), base.a.mul(U.opacity).mul(inside));
}

/* ------------------------------------------------------------------ */
/* the lens                                                            */
/* ------------------------------------------------------------------ */

/**
 * @param site     TextureNode holding the rendered page
 * @param project  TextureNode holding the project panels (alpha = coverage)
 */
export function lensOutput(site, project, U) {
  const aspect = screenSize.x.div(screenSize.y);

  // Centre the screen and undo the aspect, so the dome stays round.
  const p = screenUV.sub(0.5).mul(vec2(aspect, 1.0));
  const radius = max(U.radius, 1e-4);

  const q = p.div(radius);
  const r = length(q);
  const dir = q.div(max(r, 1e-5));

  // one pixel in rim radii: keeps the shadow's edge crisp but not aliased
  const aaWidth = fwidth(r).mul(1.1);

  /**
   * One wavelength's path through the glass. `k` scales the bend, and sampling
   * the channels at slightly different k is what splits the edge: a real
   * dielectric bends short wavelengths harder than long ones.
   */
  const channel = Fn(([rad, k]) => {
    const t = rad.sub(1.0).div(U.band);
    const bump = max(oneMinus(t.mul(t)), 0.0);
    const slope = bump.mul(bump);

    const bent = max(rad.sub(U.bulge.mul(k).mul(slope)), 0.0);
    const source = dir.mul(bent).mul(radius).div(vec2(aspect, 1.0)).add(0.5);

    // Cut the shadow in bent space, so the glass carries its own edge rather
    // than having a circle stamped over the top of it.
    const lit = smoothstep(oneMinus(aaWidth), aaWidth.add(1.0), bent);
    return site.sample(source).rgb.mul(lit);
  });

  const page = Fn(([rad]) =>
    vec3(
      channel(rad, oneMinus(U.disp)).r,
      channel(rad, float(1.0)).g,
      channel(rad, U.disp.add(1.0)).b
    )
  );

  // Only sample wider where the glass is actually bending: d(slope)/dr is
  // -4t(1 - t^2)/band, which is zero across the shadow and the flat page.
  const tHere = r.sub(1.0).div(U.band);
  const bumpHere = max(oneMinus(tHere.mul(tHere)), 0.0);
  const warp = abs(U.bulge.mul(tHere).mul(bumpHere).mul(4.0).div(U.band));
  const spread = min(fwidth(r).mul(U.aa).mul(warp), 0.05);

  const lensed = page(r)
    .add(page(max(r.sub(spread), 0.0)))
    .add(page(r.add(spread)))
    .div(float(LENS_TAPS));

  // The project sits flat on the shadow: sampled straight, never bent, and
  // already clipped inside the rim by the sheet's own throat mask.
  const panel = project.sample(screenUV);
  const straight = panel.rgb.div(max(panel.a, 1e-4));

  return vec4(mix(lensed, straight, panel.a), 1.0);
}
