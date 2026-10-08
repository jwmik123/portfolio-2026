"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
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

/** dome radius as a fraction of the viewport height — nearly edge to edge. */
const RIM = 0.47;
/** never wider than this fraction of the viewport width. */
const RIM_MAX_W = 0.94;
/**
 * Half-width of a screenshot, in rim radii. The middle of the lens is now the
 * identity rather than a magnifier, so this is the project's true scale —
 * under 1 to pull back and show more of each page at once.
 */
const FRAME = 0.84;
/** The project stays visible out through the curved band, so the sheet has to
 *  carry geometry past the rim. */
const PANEL_EXTENT = 1.45;
/** where the sheet is cut off, in rim radii */
const THROAT = 1.3;

const FOV = 35;
const CAM_Z = 5;

const OPEN_D = 1.5;
const SWITCH_D = 1.15;

/**
 * Resting refraction. What matters is bulge / band: at 0.53 the strongest
 * point of the roll magnifies about 5x, and anything past 0.65 folds the map
 * into a caustic ring.
 */
const BULGE_REST = 0.2;
const BAND_REST = 0.38;

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
        pu.frame.value = FRAME;

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

      }

      /** Ties the strip's u and v to one scale: v travelled per rim radius. */
      function fitPanel(panel: Panel) {
        panel.U.vScale.value = panel.atlas.widthV / (2 * FRAME);
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
          canvas.style.cursor = insideRim(e.clientX, e.clientY) ? "grab" : "";
        }
      };

      const onPointerDown = (e: PointerEvent) => {
        if (portalU.radius.value < 1e-3) return;
        if (!insideRim(e.clientX, e.clientY)) {
          onCloseRef.current();
          return;
        }
        dragging = true;
        pointerId = e.pointerId;
        lastY = e.clientY;
        moved = 0;
        velocity = 0;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = "grabbing";
      };

      const endDrag = (e: PointerEvent) => {
        if (!dragging || e.pointerId !== pointerId) return;
        dragging = false;
        pointerId = -1;
        if (moved < 3) velocity = 0;
        canvas.releasePointerCapture(e.pointerId);
        canvas.style.cursor = "grab";
      };

      const onWheel = (e: WheelEvent) => {
        if (portalU.radius.value < 1e-3) return;
        if (!insideRim(e.clientX, e.clientY)) return;
        e.preventDefault();
        velocity = 0;
        const delta =
          (-e.deltaY / layout.rimPx) * panels[active].U.vScale.value;
        setScroll(panels[active].U.vCenter.value + delta);
      };

      const onPointerLeave = () => {
        fluidU.pointerActive.value = 0;
      };

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerleave", onPointerLeave);
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);
      canvas.addEventListener("wheel", onWheel, { passive: false });

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

        if (pu.vCenter.value < lo || pu.vCenter.value > hi) {
          const target = pu.vCenter.value < lo ? lo : hi;
          pu.vCenter.value += (target - pu.vCenter.value) * 0.18;
          velocity = 0;
          return;
        }

        // once the throw has died down, settle on a whole screenshot
        if (Math.abs(velocity) < 2.5e-4) {
          const centers = panels[active].atlas.centers;
          let nearest = centers[0];
          for (const c of centers) {
            if (Math.abs(c - pu.vCenter.value) < Math.abs(nearest - pu.vCenter.value)) {
              nearest = c;
            }
          }
          const gap = nearest - pu.vCenter.value;
          if (Math.abs(gap) > 1e-5) {
            pu.vCenter.value += gap * 0.1;
            velocity = 0;
          }
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

      function frame() {
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
          panels[active].U.vCenter.value = panels[active].atlas.centers[0];

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
            .fromTo(num(portalU.band), { value: 0.9 }, { value: BAND_REST, duration: 1.9, ease: "power2.out" }, 0);
        },

        close() {
          timeline?.kill();
          timeline = gsap
            .timeline()
            .to(num(portalU.bulge), { value: 0.46, duration: 0.8, ease: "power2.in" }, 0)
            .to(num(portalU.band), { value: 0.9, duration: 0.8, ease: "power2.in" }, 0)
            .to(num(portalU.radius), { value: 0, duration: 0.9, ease: "expo.in" }, 0.12);
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
          canvas.removeEventListener("pointerdown", onPointerDown);
          canvas.removeEventListener("pointerup", endDrag);
          canvas.removeEventListener("pointercancel", endDrag);
          canvas.removeEventListener("wheel", onWheel);

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

  const step = useCallback(
    (dir: 1 | -1) => {
      const ctrl = ctrlRef.current;
      if (!ctrl || ctrl.isBusy() || projects.length < 2) return;
      setIndex((current) => {
        const next = (current + dir + projects.length) % projects.length;
        ctrl.switchTo(next, dir);
        return next;
      });
    },
    [projects.length]
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

  return (
    <>
      <div ref={hostRef} className="fixed inset-0 -z-10" />

      <div
        // The dome reaches nearly to the top and bottom edges, so there is no
        // room under it: the controls live at the foot of the screen instead.
        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-4 transition-opacity duration-700"
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          // the project behind these can be white or near-black, so the
          // controls carry their own contrast rather than relying on it
          filter: "drop-shadow(0 2px 16px rgba(0,0,0,0.75))",
        }}
      >
        <div className="flex items-center gap-8">
          <PortalArrow
            direction="left"
            onClick={() => step(-1)}
            disabled={projects.length < 2}
          />
          <div className="text-center min-w-48">
            <p className="font-retro uppercase text-white text-xl tracking-wide leading-none">
              {project?.title}
            </p>
            {project?.meta && (
              <p className="text-white/70 text-xs uppercase tracking-[0.2em] mt-2">
                {project.meta}
              </p>
            )}
          </div>
          <PortalArrow
            direction="right"
            onClick={() => step(1)}
            disabled={projects.length < 2}
          />
        </div>

        <div className="flex items-center gap-2">
          {projects.map((p, i) => (
            <span
              key={p.title}
              className="h-[2px] rounded-full transition-all duration-500"
              style={{
                width: i === index ? 28 : 10,
                background:
                  i === index
                    ? "rgba(255,255,255,0.9)"
                    : "rgba(255,255,255,0.25)",
              }}
            />
          ))}
        </div>

        <p className="text-white/55 text-[11px] uppercase tracking-[0.2em]">
          Drag to scroll · Esc to close
        </p>
      </div>
    </>
  );
}

function PortalArrow({
  direction,
  onClick,
  disabled,
}: {
  direction: "left" | "right";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "left" ? "Previous project" : "Next project"}
      className="grid place-items-center h-12 w-12 rounded-full border border-white/30 bg-black/25 text-white/90 transition-all duration-300 hover:border-white/80 hover:bg-black/40 hover:text-white hover:scale-110 disabled:opacity-20 disabled:hover:scale-100"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 15 15"
        fill="none"
        style={{ transform: direction === "left" ? "scaleX(-1)" : undefined }}
      >
        <path
          d="M2 7.5h10.5M8.5 3.5l4 4-4 4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
