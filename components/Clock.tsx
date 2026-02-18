"use client";

import { useEffect, useRef, useCallback } from "react";

function formatTime(date: Date, timeZone: string) {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  });
}

const LABEL_AMS = " Amsterdam (CET)";
const LABEL_LOCAL = " Local";
const OFFSET_INCREMENT = 0.01;
const TRANSITION = "transform 0.6s cubic-bezier(0.625, 0.05, 0, 1)";

export default function Clock() {
  const containerRef = useRef<HTMLSpanElement>(null);
  const wrappersRef = useRef<HTMLSpanElement[]>([]);
  const topCharsRef = useRef<HTMLSpanElement[]>([]);
  const bottomCharsRef = useRef<HTMLSpanElement[]>([]);
  const hoveredRef = useRef(false);
  const builtRef = useRef(false);

  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const isLocalAmsterdam = localTz === "Europe/Amsterdam";

  const buildChars = useCallback(
    (topText: string, bottomText: string) => {
      const container = containerRef.current;
      if (!container) return;
      container.innerHTML = "";
      wrappersRef.current = [];
      topCharsRef.current = [];
      bottomCharsRef.current = [];

      const maxLen = Math.max(topText.length, bottomText.length);

      for (let i = 0; i < maxLen; i++) {
        const topChar = topText[i] ?? " ";
        const bottomChar = bottomText[i] ?? " ";

        // Outer wrapper — clips overflow
        const wrapper = document.createElement("span");
        wrapper.style.overflow = "hidden";
        wrapper.style.display = "inline-block";
        wrapper.style.verticalAlign = "top";
        wrapper.style.lineHeight = "1.3";
        wrapper.style.height = "1.3em";

        // Inner slider — holds both chars stacked, transitions on hover
        const slider = document.createElement("span");
        slider.style.display = "block";
        slider.style.transition = TRANSITION;
        slider.style.transitionDelay = `${i * OFFSET_INCREMENT}s`;
        slider.style.transform = "translateY(0em)";

        const top = document.createElement("span");
        top.textContent = topChar;
        top.style.display = "block";
        top.style.height = "1.3em";
        top.style.lineHeight = "1.3";
        if (topChar === " ") top.style.whiteSpace = "pre";

        const bottom = document.createElement("span");
        bottom.textContent = bottomChar;
        bottom.style.display = "block";
        bottom.style.height = "1.3em";
        bottom.style.lineHeight = "1.3";
        if (bottomChar === " ") bottom.style.whiteSpace = "pre";

        slider.appendChild(top);
        slider.appendChild(bottom);
        wrapper.appendChild(slider);
        container.appendChild(wrapper);

        wrappersRef.current.push(slider);
        topCharsRef.current.push(top);
        bottomCharsRef.current.push(bottom);
      }
    },
    []
  );

  const setHoverState = useCallback((hovered: boolean) => {
    wrappersRef.current.forEach((slider) => {
      slider.style.transform = hovered
        ? "translateY(-1.3em)"
        : "translateY(0em)";
    });
  }, []);

  // Update time characters in place without rebuilding DOM
  const updateTime = useCallback(
    (amsTime: string, localTimeStr: string) => {
      const topChars = topCharsRef.current;
      const bottomChars = bottomCharsRef.current;
      if (topChars.length === 0) return;

      // Only update the 8 time chars (HH:MM:SS)
      for (let i = 0; i < 8 && i < topChars.length; i++) {
        topChars[i].textContent = amsTime[i] ?? " ";
      }
      for (let i = 0; i < 8 && i < bottomChars.length; i++) {
        bottomChars[i].textContent = localTimeStr[i] ?? " ";
      }
    },
    []
  );

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const amsTime = formatTime(now, "Europe/Amsterdam");
      const localTimeStr = formatTime(now, localTz);

      if (!builtRef.current) {
        buildChars(
          amsTime + LABEL_AMS,
          isLocalAmsterdam ? amsTime + LABEL_AMS : localTimeStr + LABEL_LOCAL
        );
        builtRef.current = true;
      } else {
        updateTime(amsTime, isLocalAmsterdam ? amsTime : localTimeStr);
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [buildChars, updateTime, isLocalAmsterdam, localTz]);

  const handleMouseEnter = useCallback(() => {
    if (isLocalAmsterdam) return;
    hoveredRef.current = true;
    setHoverState(true);
  }, [isLocalAmsterdam, setHoverState]);

  const handleMouseLeave = useCallback(() => {
    if (isLocalAmsterdam) return;
    hoveredRef.current = false;
    setHoverState(false);
  }, [isLocalAmsterdam, setHoverState]);

  return (
    <span
      className="font-bold select-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ display: "inline-flex" }}
    >
      <span ref={containerRef} style={{ display: "inline-flex" }} />
    </span>
  );
}
