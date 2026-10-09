"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import Lenis from "lenis";
import {
  CanvasTexture,
  DoubleSide,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  NodeMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  PostProcessing,
  RenderTarget,
  RGBAFormat,
  Scene,
  WebGPURenderer,
} from "three/webgpu";
import { texture as textureNode } from "three/tsl";

import { buildProjectAtlas, type ProjectAtlas } from "@/lib/projectAtlas";
import {
  createFluidUniforms,
  fluidSeedNode,
  fluidStepNode,
} from "@/lib/fluidNodes";
import { createSiteUniforms, siteBackgroundNode } from "@/lib/siteNodes";
import {
  createPanelUniforms,
  createPortalUniforms,
  lensOutput,
  panelColorNode,
  panelPositionNode,
} from "@/lib/blackholeNodes";

export interface PortalProject {
  title: string;
  meta?: string;
  images: string[];
}

/** rim radius as a fraction of the viewport height. */
const RIM = 0.37;
/** never wider than this fraction of the viewport width. */
const RIM_MAX_W = 0.94;
const PANEL_EXTENT = 1.0;
/** where the sheet is cut off, in rim radii */
const THROAT = 1.0;
/** how much of that circle the screenshot is allowed to fill */
const FIT = 0.96;

const FOV = 35;
const CAM_Z = 5;

const OPEN_D = 1.5;
/** the project's own entrance, which runs after the hole has opened */
const SHEET_D = 1.0;
const SWITCH_D = 1.15;
/** how much of the sheet's exit plays before the hole starts to close */
const CLOSE_OVERLAP = 0.55;

/** rim radii of scroll per frame that drives the ripple to full */
const RIPPLE_FULL = 0.07;
/** ripple phase per rim radius scrolled */
const RIPPLE_SCRUB = 2.5;

/**
 * Resting refraction. What matters is bulge / band: at 0.53 the strongest
 * point of the roll magnifies about 5x, and anything past 0.65 folds the map
 * into a caustic ring.
 */
const BULGE_REST = 0.2;
const BAND_REST = 0.38;
/** how far apart the channels are bent — the width of the prism fringe */
const DISP_REST = 0.12;

/** TSL uniform nodes carry a plain `.value`; GSAP only needs that much. */
type NumUniform = { value: number };
const num = (u: unknown) => u as NumUniform;

interface Panel {
  mesh: Mesh;
  material: MeshBasicNodeMaterial;
  U: ReturnType<typeof createPanelUniforms>;
  atlas: ProjectAtlas;
}

interface Controller {
  open: () => void;
  close: () => void;
  switchTo: (index: number, dir: 1 | -1) => void;
  isBusy: () => boolean;
  dispose: () => void;
}

interface CharData {
  char: string;
  x: number;
  y: number;
  opacity: number;
  yOffset: number;
}

export default function SiteCanvas({
  projects,
  text,
  open,
  onClose,
}: {
  projects: PortalProject[];
  text?: string[];
  open: boolean;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<Controller | null>(null);
  const pendingOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /** rim radius and viewport width in px, to keep the chrome outside the glass */
  const [frame, setFrame] = useState({ rim: 0, w: 0 });
  const [ready, setReady] = useState(false);
  const [index, setIndex] = useState(0);


  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const atlases: ProjectAtlas[] = await Promise.all(
        projects.map((p) => buildProjectAtlas(p.images))
      );
      if (disposed) return;

      // The background has always rendered at CSS resolution. Going to the
      // device ratio quadrupled the cost of the pattern pass *and* of the
      // lens, which is what made the pointer trail stutter.
      const dpr = 1;

      const imageAspect = atlases[0].imageAspect;
      /**
       * Half-width of a screenshot, in rim radii. A rectangle of half-width f
       * and half-height f * imageAspect has its corners at f * hypot(1,
       * imageAspect), and the throat is a circle — so this is the largest the
       * project can be before the circle starts biting its corners off.
       */
      const shotHalf = (FIT * THROAT) / Math.hypot(1, imageAspect);
      let cssW = window.innerWidth;
      let cssH = window.innerHeight;

      const renderer = new WebGPURenderer({ antialias: false, alpha: false });
      renderer.setPixelRatio(dpr);
      renderer.setSize(cssW, cssH);
      // Render targets must clear to *transparent* black: the project target's
      // alpha is what tells the lens where the project actually is.
      renderer.setClearColor(0x000000, 0);
      await renderer.init();
      if (disposed) {
        renderer.dispose();
        return;
      }

      const canvas = renderer.domElement;
      canvas.style.display = "block";
      host.appendChild(canvas);

      /* ---- shared full-screen quad ---------------------------------- */

      const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const quadScene = new Scene();
      const quadMesh = new Mesh(new PlaneGeometry(2, 2), new NodeMaterial());
      quadMesh.frustumCulled = false;
      quadScene.add(quadMesh);

      /**
       * The fluid needs float32. Its pressure gradient is the difference
       * between neighbouring texels of a value that sits around 0.3, and half
       * floats only resolve about 5e-4 there — so the difference quantises to
       * zero and the trail advances in visible steps instead of flowing.
       * WebGPU can only filter float32 with the `float32-filterable` feature;
       * WebGL2 does it through OES_texture_float_linear, which is universal.
       */
      const backend = renderer.backend as { isWebGLBackend?: boolean };
      const filterableFloat =
        backend.isWebGLBackend === true ||
        renderer.hasFeature("float32-filterable");

      const fluidOptions = {
        type: filterableFloat ? FloatType : HalfFloatType,
        format: RGBAFormat,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
      };

      // The display targets only ever hold colour, so half floats are plenty.
      const targetOptions = {
        type: HalfFloatType,
        format: RGBAFormat,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
      };

      /* ---- pass 1: the fluid ---------------------------------------- */

      let fluidA = new RenderTarget(cssW, cssH, fluidOptions);
      let fluidB = new RenderTarget(cssW, cssH, fluidOptions);

      const fluidU = createFluidUniforms(fluidB.texture);
      fluidU.resolution.value.set(cssW, cssH);

      const fluidMaterial = new NodeMaterial();
      // fragmentNode, not colorNode: the colorNode path clamps its output to
      // >= 0, which would throw away every leftward and downward velocity.
      fluidMaterial.fragmentNode = fluidStepNode(fluidU);
      const seedMaterial = new NodeMaterial();
      seedMaterial.fragmentNode = fluidSeedNode(fluidU);

      /* ---- pass 2: the site background ------------------------------ */

      const textCanvas = document.createElement("canvas");
      textCanvas.width = cssW;
      textCanvas.height = cssH;
      const ctx = textCanvas.getContext("2d")!;
      const textTexture = new CanvasTexture(textCanvas);
      textTexture.minFilter = LinearFilter;
      textTexture.magFilter = LinearFilter;

      const siteU = createSiteUniforms(fluidA.texture, textTexture);
      siteU.resolution.value.set(cssW, cssH);

      const siteMaterial = new NodeMaterial();
      siteMaterial.colorNode = siteBackgroundNode(siteU);

      const siteTarget = new RenderTarget(
        Math.round(cssW * dpr),
        Math.round(cssH * dpr),
        { ...targetOptions, depthBuffer: false }
      );

      /* ---- pass 3: the project panels -------------------------------- */

      const projectScene = new Scene();
      const projectCamera = new PerspectiveCamera(FOV, cssW / cssH, 0.1, 50);
      projectCamera.position.z = CAM_Z;

      const projectTarget = new RenderTarget(
        Math.round(cssW * dpr),
        Math.round(cssH * dpr),
        { ...targetOptions, depthBuffer: true }
      );

      const panels: Panel[] = [0, 1].map((i) => {
        const pu = createPanelUniforms(atlases[0].texture);
        pu.extent.value = PANEL_EXTENT;
        pu.frame.value = shotHalf;

        const material = new MeshBasicNodeMaterial({
          transparent: true,
          side: DoubleSide,
          depthWrite: false,
        });
        material.colorNode = panelColorNode(pu);
        material.positionNode = panelPositionNode(pu);

        const mesh = new Mesh(new PlaneGeometry(1, 1, 72, 48), material);
        mesh.renderOrder = i;
        mesh.visible = i === 0;
        projectScene.add(mesh);
        return { mesh, material, U: pu, atlas: atlases[0] };
      });
      let active = 0;

      /* ---- pass 4: the lens ------------------------------------------ */

      const portalU = createPortalUniforms();
      const postProcessing = new PostProcessing(renderer);
      postProcessing.outputNode = lensOutput(
        textureNode(siteTarget.texture),
        textureNode(projectTarget.texture),
        portalU
      );

      /* ---- layout ---------------------------------------------------- */

      const layout = { rim: 0, rimPx: 0, panelWorld: 0, throatWorld: 0 };

      function measure() {
        const rim = Math.min(RIM, (RIM_MAX_W / 2) * (cssW / cssH));
        layout.rim = rim;
        layout.rimPx = rim * cssH;

        const visibleHeight = 2 * Math.tan((FOV * Math.PI) / 360) * CAM_Z;
        const pxToWorld = visibleHeight / cssH;
        layout.panelWorld = PANEL_EXTENT * 2 * layout.rimPx * pxToWorld;
        layout.throatWorld = THROAT * layout.rimPx * pxToWorld;

        setFrame({ rim: layout.rimPx, w: cssW });
      }

      /** Ties the strip's u and v to one scale: v travelled per rim radius. */
      function fitPanel(panel: Panel) {
        panel.U.vScale.value = panel.atlas.widthV / (2 * shotHalf);
      }

      function halfViewV() {
        return PANEL_EXTENT * panels[active].U.vScale.value;
      }

      function applyGeometry() {
        for (const panel of panels) {
          panel.mesh.geometry.dispose();
          panel.mesh.geometry = new PlaneGeometry(
            layout.panelWorld,
            layout.panelWorld,
            72,
            48
          );
          panel.U.amp.value = layout.panelWorld * 0.26;
          panel.U.throat.value = layout.throatWorld;
          fitPanel(panel);
        }
      }

      measure();
      applyGeometry();
      panels[0].U.vCenter.value = atlases[0].centers[0];

      /* ---- the hero type --------------------------------------------- */

      const chars: CharData[] = [];
      let textReady = false;
      let textAnimating = false;
      /** one more upload is owed, after a resize or the last tween frame */
      let textDirty = true;
      let fontStr = "";

      function resolveFont() {
        const probe = document.createElement("span");
        probe.style.cssText =
          "font-family:var(--font-retro);position:absolute;visibility:hidden";
        probe.textContent = "X";
        document.body.appendChild(probe);
        const family = getComputedStyle(probe).fontFamily;
        probe.remove();
        return family;
      }

      function layoutText(family: string) {
        chars.length = 0;
        if (!text || text.length === 0) return;

        const fontSize = Math.min(cssW * 0.135, 300);
        const letterSpacing = -0.025 * fontSize;
        const lineHeight = fontSize * 0.7;
        fontStr = `${fontSize}px ${family}`;
        ctx.font = fontStr;

        const totalHeight = text.length * lineHeight;
        const startY = cssH - 2 * totalHeight;

        text.forEach((line, lineIndex) => {
          const glyphs = line.toUpperCase().split("");
          let lineWidth = 0;
          glyphs.forEach((ch, i) => {
            lineWidth += ctx.measureText(ch).width;
            if (i < glyphs.length - 1) lineWidth += letterSpacing;
          });

          let x = (cssW - lineWidth) / 2;
          const y = startY + lineIndex * lineHeight;
          glyphs.forEach((ch) => {
            chars.push({ char: ch, x, y, opacity: 0, yOffset: 80 });
            x += ctx.measureText(ch).width + letterSpacing;
          });
        });
      }

      if (text && text.length > 0) {
        document.fonts.ready.then(() => {
          if (disposed) return;
          layoutText(resolveFont());
          textAnimating = true;
          gsap.to(chars, {
            opacity: 0.6,
            yOffset: 0,
            duration: 2.5,
            stagger: 0.1,
            ease: "power3.out",
            delay: 0.5,
            onComplete: () => {
              textAnimating = false;
              textDirty = true;
            },
          });
          textReady = true;
        });
      }

      function drawText() {
        // Re-uploading a full-screen canvas every frame costs megabytes of
        // texture traffic and stalls the pipeline. The type only changes while
        // it is animating in, so after that we upload nothing.
        if (!textAnimating && !textDirty) return;

        ctx.clearRect(0, 0, textCanvas.width, textCanvas.height);
        if (!textReady) {
          textTexture.needsUpdate = true;
          textDirty = false;
          return;
        }
        ctx.font = fontStr;
        ctx.textBaseline = "top";
        ctx.fillStyle = "#ffffff";
        for (const c of chars) {
          if (c.opacity <= 0) continue;
          ctx.globalAlpha = c.opacity;
          ctx.fillText(c.char, c.x, c.y + c.yOffset);
        }
        ctx.globalAlpha = 1;
        textTexture.needsUpdate = true;
        if (!textAnimating) textDirty = false;
      }

      /* ---- pointer ---------------------------------------------------- */

      let pointerX = 0;
      let pointerY = 0;
      let prevPointerX = 0;
      let prevPointerY = 0;
      let lastMove = 0;

      let dragging = false;
      let pointerId = -1;
      let lastY = 0;
      let velocity = 0;
      let moved = 0;

      function insideRim(clientX: number, clientY: number) {
        const px = (clientX / cssW - 0.5) * (cssW / cssH);
        const py = clientY / cssH - 0.5;
        const r = portalU.radius.value || 1e-4;
        return Math.hypot(px, py) / r < 1;
      }

      function setScroll(value: number) {
        const half = halfViewV();
        const lo = half;
        const hi = 1 - half;
        let v = value;
        if (v < lo) v = lo + (v - lo) * 0.35;
        else if (v > hi) v = hi + (v - hi) * 0.35;
        panels[active].U.vCenter.value = v;
      }

      const onPointerMove = (e: PointerEvent) => {
        prevPointerX = pointerX;
        prevPointerY = pointerY;
        pointerX = e.clientX;
        pointerY = cssH - e.clientY;
        lastMove = performance.now();
        fluidU.pointer.value.set(
          pointerX,
          pointerY,
          prevPointerX,
          prevPointerY
        );
        fluidU.pointerActive.value = 1;

        if (dragging && e.pointerId === pointerId) {
          const dy = e.clientY - lastY;
          lastY = e.clientY;
          moved += Math.abs(dy);
          // v decreases going down the strip, so a drag upwards walks down it
          const delta =
            (dy / layout.rimPx) * panels[active].U.vScale.value;
          velocity = delta;
          setScroll(panels[active].U.vCenter.value + delta);
        } else if (portalU.radius.value > 1e-3) {
          document.body.style.cursor = insideRim(e.clientX, e.clientY)
            ? "grab"
            : "";
        }
      };

      /**
       * The canvas is the page's background and sits at -z-10, so the site's
       * own markup is on top of it and pointer events never reach it. These
       * listeners therefore live on the document, and skip anything that came
       * from a real control.
       */
      const fromChrome = (e: Event) =>
        !!(e.target as HTMLElement | null)?.closest?.(
          "button, a, [data-portal-ui]"
        );

      const onPointerDown = (e: PointerEvent) => {
        if (portalU.radius.value < 1e-3 || fromChrome(e)) return;
        if (!insideRim(e.clientX, e.clientY)) {
          onCloseRef.current();
          return;
        }
        dragging = true;
        // the hand takes the sheet: drop whatever the wheel was still easing
        lenis.stop();
        pointerId = e.pointerId;
        lastY = e.clientY;
        moved = 0;
        velocity = 0;
        document.body.style.cursor = "grabbing";
      };

      const endDrag = (e: PointerEvent) => {
        if (!dragging || e.pointerId !== pointerId) return;
        dragging = false;
        if (portalU.radius.value > 1e-3) lenis.start();
        pointerId = -1;
        if (moved < 3) velocity = 0;
        document.body.style.cursor = "grab";
      };

      /**
       * Wheel and trackpad go through Lenis. It scrolls a hidden element whose
       * height is the strip's scroll range, and that scroll position is mapped
       * back onto vCenter: Lenis owns the smoothing, the strip just follows.
       * Dragging stays our own, because it has to grab the sheet, not a page.
       */
      const scroller = document.createElement("div");
      scroller.setAttribute("aria-hidden", "true");
      scroller.style.cssText =
        "position:fixed;top:0;left:0;width:1px;height:100px;overflow:hidden;visibility:hidden;pointer-events:none;";
      const scrollContent = document.createElement("div");
      scroller.appendChild(scrollContent);
      host.appendChild(scroller);

      /** strip v per scrolled pixel, at the rim's on-screen size */
      const vPerPx = () => panels[active].U.vScale.value / layout.rimPx;
      const toPx = (v: number) => (1 - halfViewV() - v) / vPerPx();

      const lenis = new Lenis({
        wrapper: scroller,
        content: scrollContent,
        eventsTarget: window,
        autoResize: false,
        lerp: 0.085,
        prevent: (node) => node.matches("button, a, [data-portal-ui]"),
        virtualScroll: ({ event }) =>
          event.type === "wheel" &&
          portalU.radius.value > 1e-3 &&
          insideRim(
            (event as WheelEvent).clientX,
            (event as WheelEvent).clientY
          ),
      });
      lenis.stop();

      lenis.on("scroll", () => {
        // Only while Lenis is easing a wheel. Our own syncs and the native
        // scroll events behind them must not write back, or they would clamp
        // the rubber-band at the ends of the strip.
        if (lenis.isScrolling !== "smooth") return;
        velocity = 0;
        setScroll(1 - halfViewV() - lenis.animatedScroll * vPerPx());
      });

      let rangePx = -1;

      /** Keep Lenis's range and position in step with the strip. */
      function stepLenis(time: number) {
        const half = halfViewV();
        const range = Math.max(0, Math.round((1 - 2 * half) / vPerPx()));
        if (range !== rangePx) {
          rangePx = range;
          scrollContent.style.height = `${100 + range}px`;
          lenis.resize();
        }

        lenis.raf(time);

        // Anything else that moved the strip — a drag, a switch, opening —
        // leaves Lenis behind; pull it along so the next wheel starts here.
        if (!lenis.isScrolling) {
          const px = Math.min(Math.max(toPx(panels[active].U.vCenter.value), 0), range);
          if (Math.abs(px - lenis.animatedScroll) > 0.5) {
            lenis.scrollTo(px, { immediate: true, force: true });
          }
        }
      }

      const onPointerLeave = () => {
        fluidU.pointerActive.value = 0;
      };

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerleave", onPointerLeave);
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("pointerup", endDrag);
      document.addEventListener("pointercancel", endDrag);

      function stepSlider() {
        if (dragging) return;
        const pu = panels[active].U;
        const half = halfViewV();
        const lo = half;
        const hi = 1 - half;

        if (Math.abs(velocity) > 1e-6) {
          setScroll(pu.vCenter.value + velocity);
          velocity *= 0.92;
        }

        // A project is a long page, so this scrolls freely and only
        // rubber-bands at the two ends. Snapping to whole screenshots meant a
        // drag had to cross half a screenshot — about 470px — before it stuck,
        // and anything shorter sprang back, which read as not scrolling at all.
        if (pu.vCenter.value < lo || pu.vCenter.value > hi) {
          const target = pu.vCenter.value < lo ? lo : hi;
          pu.vCenter.value += (target - pu.vCenter.value) * 0.18;
          velocity = 0;
        }
      }

      /**
       * The strip ripples like cloth being dragged. The wave's phase is pushed
       * by the distance scrolled, so it is scrubbed by the hand rather than
       * running on a clock; once the strip stops it rings out and settles.
       */
      let lastV = panels[active].U.vCenter.value;
      let lastActive = active;

      function stepRipple() {
        const pu = panels[active].U;
        if (lastActive !== active) {
          lastActive = active;
          lastV = pu.vCenter.value;
        }
        const d = (pu.vCenter.value - lastV) / pu.vScale.value;
        lastV = pu.vCenter.value;

        const target = Math.min(Math.abs(d) / RIPPLE_FULL, 1);
        // quick to catch, slow to let go: cloth keeps moving after the hand
        const k = target > pu.ripple.value ? 0.2 : 0.045;
        pu.ripple.value += (target - pu.ripple.value) * k;
        if (Math.abs(d) > 1e-5) {
          pu.rippleDir.value += (Math.sign(d) - pu.rippleDir.value) * 0.12;
        }
        pu.ripplePhase.value +=
          Math.abs(d) * RIPPLE_SCRUB + pu.ripple.value * 0.035;

        for (const panel of panels) {
          if (panel !== panels[active]) panel.U.ripple.value *= 0.9;
        }
      }

      /* ---- resize ------------------------------------------------------ */

      const onResize = () => {
        cssW = window.innerWidth;
        cssH = window.innerHeight;

        renderer.setSize(cssW, cssH);
        projectCamera.aspect = cssW / cssH;
        projectCamera.updateProjectionMatrix();

        fluidA.setSize(cssW, cssH);
        fluidB.setSize(cssW, cssH);
        fluidU.resolution.value.set(cssW, cssH);
        siteU.resolution.value.set(cssW, cssH);
        siteTarget.setSize(Math.round(cssW * dpr), Math.round(cssH * dpr));
        projectTarget.setSize(Math.round(cssW * dpr), Math.round(cssH * dpr));

        textCanvas.width = cssW;
        textCanvas.height = cssH;
        // WebGPU allocates a texture once, at its first upload, and only ever
        // copies into it after that. A canvas of a new size would be written
        // into the old allocation and the type comes out garbled, so drop it
        // and let the next upload allocate one that fits.
        textTexture.dispose();
        textDirty = true;
        if (textReady) {
          layoutText(resolveFont());
          chars.forEach((c) => {
            c.opacity = 0.6;
            c.yOffset = 0;
          });
        }

        measure();
        applyGeometry();
        seeded = false;

        if (portalU.radius.value > 1e-3 && !timeline?.isActive()) {
          portalU.radius.value = layout.rim;
        }
      };
      window.addEventListener("resize", onResize);

      /* ---- render loop -------------------------------------------------- */

      let seeded = false;

      function frame(time: number) {
        if (performance.now() - lastMove > 100) {
          fluidU.pointerActive.value = 0;
        }

        if (!seeded) {
          quadMesh.material = seedMaterial;
          for (const target of [fluidA, fluidB]) {
            renderer.setRenderTarget(target);
            renderer.render(quadScene, quadCamera);
          }
          seeded = true;
        }

        // fluid: advect the previous frame into the current one
        fluidU.previous.value = fluidB.texture;
        quadMesh.material = fluidMaterial;
        renderer.setRenderTarget(fluidA);
        renderer.render(quadScene, quadCamera);
        const swap = fluidA;
        fluidA = fluidB;
        fluidB = swap;

        // the page itself
        drawText();
        siteU.fluid.value = fluidB.texture;
        quadMesh.material = siteMaterial;

        // With no hole there is nothing to bend, and the lens would just be an
        // expensive way to copy the page to itself. Draw straight to the
        // screen instead: this is the state the site is in almost all the
        // time, and it costs exactly what it did before the hole existed.
        if (portalU.radius.value <= 1e-3) {
          renderer.setRenderTarget(null);
          renderer.render(quadScene, quadCamera);
          return;
        }

        renderer.setRenderTarget(siteTarget);
        renderer.render(quadScene, quadCamera);

        stepSlider();
        stepLenis(time);
        stepRipple();
        renderer.setRenderTarget(projectTarget);
        renderer.render(projectScene, projectCamera);

        renderer.setRenderTarget(null);
        postProcessing.render();
      }

      renderer.setAnimationLoop(frame);

      /* ---- timelines ---------------------------------------------------- */

      let timeline: gsap.core.Timeline | null = null;

      const control: Controller = {
        isBusy: () => !!timeline && timeline.isActive(),

        open() {
          timeline?.kill();
          velocity = 0;
          lenis.start();

          // The project arrives the same way it does on a switch: as a sheet
          // flapping in, timed to the hole opening around it.
          const sheet = panels[active];
          const travel = layout.panelWorld * 0.95;
          panels[1 - active].mesh.visible = false;
          sheet.mesh.visible = true;
          sheet.U.vCenter.value = sheet.atlas.centers[0];
          sheet.U.dir.value = 1;
          sheet.U.phase.value = 0;
          sheet.U.flap.value = 0;
          sheet.U.opacity.value = 0;
          sheet.U.shiftX.value = travel;
          sheet.U.ripple.value = 0;
          sheet.U.rippleDir.value = 0;

          // Clear the project target once, so the first lensed frame cannot
          // pick up whatever was left in it from the previous opening.
          renderer.setRenderTarget(projectTarget);
          renderer.clear();
          renderer.setRenderTarget(null);

          timeline = gsap
            .timeline()
            .to(num(portalU.radius), { value: layout.rim, duration: OPEN_D, ease: "expo.inOut" }, 0)
            // the deflection starts violent and relaxes: the hole tears open
            // the glass starts far too strong and relaxes into shape; bulge
            // and band move together so their ratio never reaches the fold
            .fromTo(num(portalU.bulge), { value: 0.46 }, { value: BULGE_REST, duration: 1.9, ease: "power2.out" }, 0)
            .fromTo(num(portalU.band), { value: 0.9 }, { value: BAND_REST, duration: 1.9, ease: "power2.out" }, 0)
            .fromTo(num(portalU.disp), { value: 0.4 }, { value: DISP_REST, duration: 1.9, ease: "power2.out" }, 0)
            // ...and only once the hole has finished opening does the sheet
            // fly in, so the two reads as two beats rather than one muddle
            .to(num(sheet.U.phase), { value: 1, duration: SHEET_D, ease: "none" }, OPEN_D)
            .to(num(sheet.U.flap), { value: 1, duration: SHEET_D * 0.38, ease: "sine.out" }, OPEN_D)
            .to(num(sheet.U.flap), { value: 0, duration: SHEET_D * 0.62, ease: "sine.in" }, OPEN_D + SHEET_D * 0.38)
            .to(num(sheet.U.shiftX), { value: 0, duration: SHEET_D, ease: "power2.out" }, OPEN_D)
            .to(num(sheet.U.opacity), { value: 1, duration: SHEET_D * 0.45, ease: "power1.out" }, OPEN_D);
        },

        close() {
          timeline?.kill();
          velocity = 0;
          lenis.stop();

          // The entrance played backwards: the sheet flaps out of the throat
          // first, and the hole only swallows itself once it is nearly gone.
          const sheet = panels[active];
          const travel = layout.panelWorld * 0.95;
          sheet.U.dir.value = 1;
          sheet.U.phase.value = 0;
          sheet.U.flap.value = 0;

          const shut = SHEET_D * CLOSE_OVERLAP;
          timeline = gsap
            .timeline()
            .to(num(sheet.U.phase), { value: 1, duration: SHEET_D, ease: "none" }, 0)
            .to(num(sheet.U.flap), { value: 1, duration: SHEET_D * 0.38, ease: "sine.out" }, 0)
            .to(num(sheet.U.flap), { value: 0, duration: SHEET_D * 0.62, ease: "sine.in" }, SHEET_D * 0.38)
            .to(num(sheet.U.shiftX), { value: -travel, duration: SHEET_D, ease: "power2.in" }, 0)
            .to(num(sheet.U.opacity), { value: 0, duration: SHEET_D * 0.45, ease: "power1.in" }, SHEET_D * 0.55)
            .to(num(sheet.U.ripple), { value: 0, duration: SHEET_D * 0.4, ease: "power1.out" }, 0)
            .to(num(portalU.bulge), { value: 0.46, duration: 0.8, ease: "power2.in" }, shut)
            .to(num(portalU.band), { value: 0.9, duration: 0.8, ease: "power2.in" }, shut)
            .to(num(portalU.disp), { value: 0.4, duration: 0.8, ease: "power2.in" }, shut)
            .to(num(portalU.radius), { value: 0, duration: 0.9, ease: "expo.in" }, shut + 0.12);
        },

        switchTo(next: number, dir: 1 | -1) {
          const from = panels[active];
          const to = panels[1 - active];

          to.atlas = atlases[next];
          to.U.map.value = atlases[next].texture;
          fitPanel(to);
          to.U.vCenter.value = atlases[next].centers[0];
          to.U.opacity.value = 0;
          to.U.phase.value = 0;
          to.U.flap.value = 0;
          to.U.dir.value = dir;
          to.U.ripple.value = 0;
          to.U.rippleDir.value = 0;
          from.U.dir.value = dir;
          from.U.phase.value = 0;
          from.U.flap.value = 0;

          const travel = layout.panelWorld * 0.95;
          to.U.shiftX.value = dir * travel;

          to.mesh.visible = true;
          to.mesh.renderOrder = 2;
          from.mesh.renderOrder = 1;

          velocity = 0;
          active = 1 - active;

          const flaps = [num(from.U.flap), num(to.U.flap)];
          const phases = [num(from.U.phase), num(to.U.phase)];

          timeline?.kill();
          timeline = gsap
            .timeline({
              onComplete: () => {
                from.mesh.visible = false;
                from.U.shiftX.value = 0;
                from.U.flap.value = 0;
              },
            })
            // one continuous travelling wave runs across both sheets
            .to(phases, { value: 1, duration: SWITCH_D, ease: "none" }, 0)
            .to(flaps, { value: 1, duration: SWITCH_D * 0.4, ease: "sine.out" }, 0)
            .to(flaps, { value: 0, duration: SWITCH_D * 0.6, ease: "sine.in" }, SWITCH_D * 0.4)
            .to(num(from.U.shiftX), { value: -dir * travel, duration: SWITCH_D, ease: "power2.inOut" }, 0)
            .to(num(to.U.shiftX), { value: 0, duration: SWITCH_D, ease: "power2.inOut" }, 0)
            .to(num(to.U.opacity), { value: 1, duration: SWITCH_D * 0.45, ease: "power1.out" }, 0)
            .to(num(from.U.opacity), { value: 0, duration: SWITCH_D * 0.45, ease: "power1.in" }, SWITCH_D * 0.45)
            // the glass flexes as the sheet whips past behind it
            .to(num(portalU.bulge), { value: 0.3, duration: SWITCH_D * 0.35, ease: "sine.out" }, 0)
            .to(num(portalU.bulge), { value: BULGE_REST, duration: SWITCH_D * 0.65, ease: "sine.inOut" }, SWITCH_D * 0.35)
            .to(num(portalU.band), { value: 0.52, duration: SWITCH_D * 0.35, ease: "sine.out" }, 0)
            .to(num(portalU.band), { value: BAND_REST, duration: SWITCH_D * 0.65, ease: "sine.inOut" }, SWITCH_D * 0.35);
        },

        dispose() {
          timeline?.kill();
          renderer.setAnimationLoop(null);
          window.removeEventListener("resize", onResize);
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerleave", onPointerLeave);
          document.removeEventListener("pointerdown", onPointerDown);
          document.removeEventListener("pointerup", endDrag);
          document.removeEventListener("pointercancel", endDrag);
          lenis.destroy();
          scroller.remove();
          document.body.style.cursor = "";

          for (const panel of panels) {
            panel.mesh.geometry.dispose();
            panel.material.dispose();
          }
          quadMesh.geometry.dispose();
          fluidMaterial.dispose();
          seedMaterial.dispose();
          siteMaterial.dispose();
          fluidA.dispose();
          fluidB.dispose();
          siteTarget.dispose();
          projectTarget.dispose();
          textTexture.dispose();
          for (const atlas of atlases) atlas.texture.dispose();
          renderer.dispose();
          canvas.remove();
        },
      };

      ctrlRef.current = control;
      cleanup = control.dispose;
      setReady(true);

      if (pendingOpenRef.current) {
        pendingOpenRef.current = false;
        control.open();
      }
    })();

    return () => {
      disposed = true;
      ctrlRef.current = null;
      cleanup?.();
    };
  }, [projects, text]);

  useEffect(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) {
      pendingOpenRef.current = open;
      return;
    }
    if (open) ctrl.open();
    else ctrl.close();
  }, [open, ready]);

  // switchTo is a side effect, so it must not run inside a state updater:
  // React may call those twice, and a second switch reuses the outgoing sheet.
  const step = useCallback(
    (dir: 1 | -1) => {
      const ctrl = ctrlRef.current;
      if (!ctrl || ctrl.isBusy() || projects.length < 2) return;
      const next = (index + dir + projects.length) % projects.length;
      ctrl.switchTo(next, dir);
      setIndex(next);
    },
    [index, projects.length]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, onClose]);

  const project = projects[index];

  /**
   * Room between the page's margin and the glass. The lens bends the page out
   * to about 0.4 rim radii past the rim, so the type keeps clear of that too.
   */
  const gutter = frame.w / 2 - frame.rim * 1.4 - 48;
  const sides = gutter >= 160;

  return (
    <>
      <div ref={hostRef} className="fixed inset-0 -z-10" />

      {/*
        The chrome sits beside the hole, never over the work: on a wide screen
        it takes the two gutters either side of the glass, and when those are
        too narrow it drops underneath. It is typeset like the rest of the
        page — the same small caps and the retro face of the monogram.
      */}
      <div
        data-portal-ui
        className="fixed inset-x-0 top-1/2 z-20 transition-opacity duration-700 text-white uppercase text-sm"
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: "none",
          ...(sides
            ? { transform: "translateY(-50%)" }
            : { marginTop: frame.rim + 28 }),
        }}
      >
        <div
          className={
            sides
              ? "flex items-center justify-between"
              : "flex flex-col items-center gap-5 text-center"
          }
          style={sides ? { paddingInline: 48 } : undefined}
        >
          <div
            className={sides ? "flex flex-col gap-3" : "flex flex-col gap-2 items-center"}
            style={sides ? { width: gutter } : undefined}
          >
            <span className="text-white/50 tabular-nums">
              {pad(index + 1)} / {pad(projects.length)}
            </span>
            <p className="font-retro font-bold text-3xl leading-none text-white/90">
              {project?.title}
            </p>
            {project?.meta && <p className="text-white/70">{project.meta}</p>}
          </div>

          <div
            className={
              sides
                ? "flex flex-col gap-3 items-end text-right"
                : "flex flex-col gap-2 items-center"
            }
            style={sides ? { width: gutter } : undefined}
          >
            <div
              className="flex gap-6"
              style={{ pointerEvents: open ? "auto" : "none" }}
            >
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={projects.length < 2}
                className="uppercase transition-opacity hover:opacity-60 disabled:opacity-30"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={projects.length < 2}
                className="uppercase transition-opacity hover:opacity-60 disabled:opacity-30"
              >
                Next
              </button>
            </div>
            <span className="text-white/50">Drag to scroll · Esc to close</span>
          </div>
        </div>
      </div>
    </>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
