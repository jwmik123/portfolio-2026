/**
 * The lens.
 *
 * Refraction displaces a sample in proportion to the slope of the surface it
 * passes through. So the shape of the glass is written directly as a slope
 * profile, and where that profile puts its weight is where the distortion
 * appears.
 *
 * The first version used a dome, h(r) = (1 - r^2)^2, whose slope peaks around
 * r = 0.58 — halfway out. That bends hardest through the middle, which both
 * magnifies the content and makes it hard to read. What is wanted instead is a
 * flat, honest middle with all the curvature gathered around the rim, rolling
 * from inside it to outside it. So the slope is a bump centred on the rim:
 *
 *     t      = (r - 1) / band
 *     s(r)   = (1 - t^2)^2          on |t| < 1, exactly zero outside
 *     R      = r - bulge * s(r)
 *
 * Both ends of that bump have zero value *and* zero derivative, which is what
 * makes the two boundaries invisible: the flat middle is pixel-for-pixel
 * untouched, the page beyond the band is pixel-for-pixel untouched, and
 * nothing anywhere betrays where either begins.
 *
 * Inside the rim the band magnifies — content swells outward over the edge.
 * Outside it compresses. That pair is what reads as the roll of a thick glass
 * edge. The strength is bulge/band: keep it under 0.65 and dR/dr stays
 * positive, so the map never folds back on itself. A fold is a caustic, and a
 * caustic is a bright ring — the thing this design exists to avoid.
 *
 * Achromatic throughout: no fringe, no halo, no tint anywhere.
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

    /** the project dissolves into the page across this range, in rim radii */
    fade: uniform(0.76),
    fadeEnd: uniform(1.24),

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

export function panelPositionNode(U) {
  const { coords, s, phase, amp } = clothCoords(U);

  const primary = sin(phase).mul(amp);
  // a second wave across the other axis turns a ribbon into cloth
  const cross = sin(
    coords.y.mul(3.6).add(U.phase.mul(7.0)).add(s.mul(2.2))
  ).mul(amp.mul(0.6));
  // the sheet gathers vertically where it folds
  const gather = cos(phase).mul(amp.mul(0.3));

  return positionLocal.add(vec3(U.shiftX, gather, primary.add(cross)));
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
  const shade = cos(phase).mul(U.flap).mul(0.7).add(1.0);

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

  /** One ray through the glass: bend it, then see where it came from. */
  const trace = Fn(([rad]) => {
    const t = rad.sub(1.0).div(U.band);
    const bump = max(oneMinus(t.mul(t)), 0.0);
    const slope = bump.mul(bump);

    // Pulling the sample inwards is what pushes content outwards over the
    // rim. Away from the band the slope is exactly zero, so this is the
    // identity and both the middle and the page are left alone.
    const source = dir
      .mul(max(rad.sub(U.bulge.mul(slope)), 0.0))
      .mul(radius)
      .div(vec2(aspect, 1.0))
      .add(0.5);

    const panel = project.sample(source);
    const page = site.sample(source).rgb;

    // The project dissolves into the page right through the curved band, so
    // the same roll that bends the page also carries the handover.
    const presence = oneMinus(smoothstep(U.fade, U.fadeEnd, rad));
    return mix(page, panel.rgb, panel.a.mul(presence));
  });

  // Only sample wider where the glass is actually bending: d(slope)/dr is
  // -4t(1 - t^2)/band, which is zero across the flat middle and the flat page.
  const tHere = r.sub(1.0).div(U.band);
  const bumpHere = max(oneMinus(tHere.mul(tHere)), 0.0);
  const warp = abs(U.bulge.mul(tHere).mul(bumpHere).mul(4.0).div(U.band));
  const spread = min(fwidth(r).mul(U.aa).mul(warp), 0.05);

  const summed = trace(r)
    .add(trace(max(r.sub(spread), 0.0)))
    .add(trace(r.add(spread)));

  return vec4(summed.div(float(LENS_TAPS)), 1.0);
}
