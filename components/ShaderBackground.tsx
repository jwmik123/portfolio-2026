"use client";

import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { vertexShader, fluidShader, displayShader } from "@/lib/shaders.js";

const config = {
  brushSize: 25.0,
  brushStrength: 0.3,
  distortionAmount: .7,
  fluidDecay: 0.98,
  trailLength: 0.8,
  stopDecay: 0.85,
  color1: "#24242a",
  color2: "#f0eff1",
  color3: "#24242a",
  color4: "#f0eff1",
  colorIntensity: 1.0,
  softness: 1.0,
  noiseAmount: 0.04,
};

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

interface CharData {
  char: string;
  x: number;
  y: number;
  opacity: number;
  yOffset: number;
}

export default function ShaderBackground({ text, children }: { text?: string[]; children?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let width = window.innerWidth;
    let height = window.innerHeight;

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const rtOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
    };
    const fluidTarget1 = new THREE.WebGLRenderTarget(width, height, rtOptions);
    const fluidTarget2 = new THREE.WebGLRenderTarget(width, height, rtOptions);

    let currentFluidTarget = fluidTarget1;
    let previousFluidTarget = fluidTarget2;
    let frameCount = 0;

    const fluidMaterial = new THREE.ShaderMaterial({
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector2(width, height) },
        iMouse: { value: new THREE.Vector4(0, 0, 0, 0) },
        iFrame: { value: 0 },
        iPreviousFrame: { value: null },
        uBrushSize: { value: config.brushSize },
        uBrushStrength: { value: config.brushStrength },
        uFluidDecay: { value: config.fluidDecay },
        uTrailLength: { value: config.trailLength },
        uStopDecay: { value: config.stopDecay },
      },
      vertexShader,
      fragmentShader: fluidShader,
    });

    // --- Text canvas setup ---
    const textCanvas = document.createElement("canvas");
    textCanvas.width = width;
    textCanvas.height = height;
    const ctx = textCanvas.getContext("2d")!;

    const textTexture = new THREE.CanvasTexture(textCanvas);
    textTexture.minFilter = THREE.LinearFilter;
    textTexture.magFilter = THREE.LinearFilter;

    const displayMaterial = new THREE.ShaderMaterial({
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector2(width, height) },
        iFluid: { value: null },
        uText: { value: textTexture },
        uDistortionAmount: { value: config.distortionAmount },
        uColor1: { value: new THREE.Vector3(...hexToRgb(config.color1)) },
        uColor2: { value: new THREE.Vector3(...hexToRgb(config.color2)) },
        uColor3: { value: new THREE.Vector3(...hexToRgb(config.color3)) },
        uColor4: { value: new THREE.Vector3(...hexToRgb(config.color4)) },
        uColorIntensity: { value: config.colorIntensity },
        uSoftness: { value: config.softness },
        uNoiseAmount: { value: config.noiseAmount },
      },
      vertexShader,
      fragmentShader: displayShader,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    const fluidPlane = new THREE.Mesh(geometry, fluidMaterial);
    const displayPlane = new THREE.Mesh(geometry, displayMaterial);

    // --- Text layout and GSAP animation ---
    const chars: CharData[] = [];
    let textReady = false;
    let fontStr = "";

    function resolveFont(): string {
      const probe = document.createElement("span");
      probe.style.fontFamily = "var(--font-retro)";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.textContent = "X";
      document.body.appendChild(probe);
      const fontFamily = getComputedStyle(probe).fontFamily;
      document.body.removeChild(probe);
      return fontFamily;
    }

    function layoutText(fontFamily: string) {
      chars.length = 0;

      const fontSize = Math.min(width * 0.135, 300);
      const letterSpacing = -0.025 * fontSize;
      const lineHeight = fontSize * 0.7;
      fontStr = `${fontSize}px ${fontFamily}`;

      ctx.font = fontStr;
      const totalTextHeight = text!.length * lineHeight;
      const startY = (height - totalTextHeight) - totalTextHeight;

      text!.forEach((line, lineIndex) => {
        const upper = line.toUpperCase();
        const lineChars = upper.split("");

        let lineWidth = 0;
        lineChars.forEach((ch, i) => {
          lineWidth += ctx.measureText(ch).width;
          if (i < lineChars.length - 1) lineWidth += letterSpacing;
        });

        let currentX = (width - lineWidth) / 2;
        const y = startY + lineIndex * lineHeight;

        lineChars.forEach((ch) => {
          const charWidth = ctx.measureText(ch).width;
          chars.push({
            char: ch,
            x: currentX,
            y,
            opacity: 0,
            yOffset: 80,
          });
          currentX += charWidth + letterSpacing;
        });
      });
    }

    if (text && text.length > 0) {
      document.fonts.ready.then(() => {
        const fontFamily = resolveFont();
        layoutText(fontFamily);

        gsap.to(chars, {
          opacity: .6,
          yOffset: 0,
          duration: 2.5,
          stagger: 0.1,
          ease: "power3.out",
          delay: 0.5,
        });

        textReady = true;
      });
    }

    function drawText() {
      ctx.clearRect(0, 0, textCanvas.width, textCanvas.height);
      if (!textReady) return;

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
    }

    // --- Mouse handling ---
    let mouseX = 0,
      mouseY = 0;
    let prevMouseX = 0,
      prevMouseY = 0;
    let lastMoveTime = 0;

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      prevMouseX = mouseX;
      prevMouseY = mouseY;
      mouseX = e.clientX - rect.left;
      mouseY = rect.height - (e.clientY - rect.top);
      lastMoveTime = performance.now();
      fluidMaterial.uniforms.iMouse.value.set(
        mouseX,
        mouseY,
        prevMouseX,
        prevMouseY
      );
    };

    const onMouseLeave = () => {
      fluidMaterial.uniforms.iMouse.value.set(0, 0, 0, 0);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseleave", onMouseLeave);

    // --- Render loop ---
    let animationId: number;

    function animate() {
      animationId = requestAnimationFrame(animate);

      const time = performance.now() * 0.0005;
      fluidMaterial.uniforms.iTime.value = time;
      displayMaterial.uniforms.iTime.value = time;
      fluidMaterial.uniforms.iFrame.value = frameCount;

      if (performance.now() - lastMoveTime > 100) {
        fluidMaterial.uniforms.iMouse.value.set(0, 0, 0, 0);
      }

      fluidMaterial.uniforms.uBrushSize.value = config.brushSize;
      fluidMaterial.uniforms.uBrushStrength.value = config.brushStrength;
      fluidMaterial.uniforms.uFluidDecay.value = config.fluidDecay;
      fluidMaterial.uniforms.uTrailLength.value = config.trailLength;
      fluidMaterial.uniforms.uStopDecay.value = config.stopDecay;

      displayMaterial.uniforms.uDistortionAmount.value = config.distortionAmount;
      displayMaterial.uniforms.uColorIntensity.value = config.colorIntensity;
      displayMaterial.uniforms.uSoftness.value = config.softness;
      displayMaterial.uniforms.uNoiseAmount.value = config.noiseAmount;
      displayMaterial.uniforms.uColor1.value.set(...hexToRgb(config.color1));
      displayMaterial.uniforms.uColor2.value.set(...hexToRgb(config.color2));
      displayMaterial.uniforms.uColor3.value.set(...hexToRgb(config.color3));
      displayMaterial.uniforms.uColor4.value.set(...hexToRgb(config.color4));

      // Redraw text canvas (GSAP mutates char objects each frame)
      drawText();

      // Fluid pass
      fluidMaterial.uniforms.iPreviousFrame.value = previousFluidTarget.texture;
      renderer.setRenderTarget(currentFluidTarget);
      renderer.render(fluidPlane, camera);

      // Display pass (composites text + pattern)
      displayMaterial.uniforms.iFluid.value = currentFluidTarget.texture;
      renderer.setRenderTarget(null);
      renderer.render(displayPlane, camera);

      const temp = currentFluidTarget;
      currentFluidTarget = previousFluidTarget;
      previousFluidTarget = temp;

      frameCount++;
    }

    const onResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;

      renderer.setSize(width, height);
      fluidMaterial.uniforms.iResolution.value.set(width, height);
      displayMaterial.uniforms.iResolution.value.set(width, height);

      fluidTarget1.setSize(width, height);
      fluidTarget2.setSize(width, height);
      frameCount = 0;

      textCanvas.width = width;
      textCanvas.height = height;
      if (textReady) {
        layoutText(resolveFont());
        chars.forEach((c) => {
          c.opacity = 1;
          c.yOffset = 0;
        });
      }
    };

    window.addEventListener("resize", onResize);
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("resize", onResize);

      renderer.dispose();
      fluidTarget1.dispose();
      fluidTarget2.dispose();
      textTexture.dispose();
      geometry.dispose();
      fluidMaterial.dispose();
      displayMaterial.dispose();

      container.removeChild(renderer.domElement);
    };
  }, [text]);

  return (
    <div className="fixed inset-0 -z-10">
      <div ref={containerRef} className="absolute inset-0" />
      {children && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          {children}
        </div>
      )}
    </div>
  );
}
