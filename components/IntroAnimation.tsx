"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

export default function IntroAnimation({
  children,
}: {
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: "power3.inOut" } });

    // Nothing visible → open a square from center
    tl.fromTo(
      containerRef.current,
      { clipPath: "inset(50% 50% 50% 50% round 5px)" },
      { clipPath: "inset(35% 35% 35% 35% round 5px)", duration: 0.8 }

    )
      // Continue expanding to full screen after 1s delay
      .fromTo(
        containerRef.current,
        { clipPath: "inset(35% 35% 35% 35% round 5px)" },
        { clipPath: "inset(0% 0% 0% 0% round 0px)", duration: 0.8, delay: 2.5 }
      );
  });

  return (
    <div
      ref={containerRef}
      style={{ clipPath: "inset(50% 50% 50% 50% round 12px)" }}
    >
      {children}
    </div>
  );
}
