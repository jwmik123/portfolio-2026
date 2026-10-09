"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

/** if the canvas never says the print is up, show the chrome anyway */
const FALLBACK_MS = 6000;

/**
 * The intro itself happens in the canvas: a drop lands in the tray and the
 * print develops (components/SiteCanvas.tsx). The chrome only waits for it,
 * hidden by CSS until <html data-intro> is set so it can't flash before
 * hydration, and then steps in once the type is up.
 */
export default function IntroAnimation({
  children,
}: {
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const items = gsap.utils.toArray<HTMLElement>("section > *");
      const root = document.documentElement;

      // the print develops on every load, so the chrome waits every time —
      // including when navigating back here with the flag left from before
      delete root.dataset.intro;

      const reveal = () => {
        window.clearTimeout(fallback);
        root.dataset.intro = "done";
        gsap.fromTo(
          items,
          { autoAlpha: 0, y: 8 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 1.2,
            stagger: 0.08,
            ease: "power3.out",
            clearProps: "transform",
          }
        );
      };

      const fallback = window.setTimeout(reveal, FALLBACK_MS);
      window.addEventListener("intro:done", reveal, { once: true });
      return () => {
        window.clearTimeout(fallback);
        window.removeEventListener("intro:done", reveal);
      };
    },
    { scope: containerRef }
  );

  return (
    <div ref={containerRef} data-intro-chrome>
      {children}
    </div>
  );
}
