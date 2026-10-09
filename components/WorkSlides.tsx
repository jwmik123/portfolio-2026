"use client";

import { useEffect, useRef, useState } from "react";

import type { PortalProject } from "@/components/SiteCanvas";

/**
 * The work on a phone. The portal needs a pointer to grab the sheet and room
 * either side of the glass for its chrome, and a phone has neither, so here
 * the projects are plain slides: swipe sideways between them, scroll down
 * through a project's screenshots.
 */
export default function WorkSlides({
  projects,
  open,
  onClose,
}: {
  projects: PortalProject[];
  open: boolean;
  onClose: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onScroll = () => {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    setIndex(Math.round(track.scrollLeft / track.clientWidth));
  };

  const go = (dir: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * track.clientWidth, behavior: "smooth" });
  };

  return (
    <div
      data-portal-ui
      role="dialog"
      aria-modal="true"
      aria-label="My work"
      aria-hidden={!open}
      inert={!open}
      className="fixed inset-0 z-30 flex flex-col bg-black/70 backdrop-blur-md font-mono text-[11px] uppercase tracking-[0.15em] text-white transition-[opacity,translate] duration-700 ease-[cubic-bezier(0.625,0.05,0,1)]"
      style={{
        opacity: open ? 1 : 0,
        translate: open ? "0 0" : "0 16px",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      <header className="flex items-center justify-between px-5 pt-6 pb-4">
        <span className="tabular-nums text-white/50">
          {pad(index + 1)} / {pad(projects.length)}
        </span>
        <button type="button" onClick={onClose} className="uppercase">
          Close
        </button>
      </header>

      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex flex-1 min-h-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {projects.map((project, i) => (
          <article
            key={`${project.title}-${i}`}
            className="flex w-full shrink-0 snap-center snap-always flex-col gap-4 overflow-y-auto overscroll-y-contain px-5 pb-10"
          >
            <div className="flex flex-col gap-2">
              <h2 className="font-bold text-3xl leading-none tracking-normal text-white/90">
                {project.title}
              </h2>
              {project.meta && <p className="text-white/60">{project.meta}</p>}
              {project.url && (
                <a
                  href={project.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-start underline underline-offset-4 decoration-white/30"
                >
                  Visit site ↗
                </a>
              )}
            </div>

            {project.images.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                className="aspect-[16/10] w-full bg-white/5 object-cover"
              />
            ))}
          </article>
        ))}
      </div>

      <footer className="flex items-center justify-between px-5 pb-6 pt-4 text-white/50">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label="Previous project"
          className="text-xl leading-none text-white disabled:opacity-30"
        >
          ←
        </button>
        <span>Swipe for more</span>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index >= projects.length - 1}
          aria-label="Next project"
          className="text-xl leading-none text-white disabled:opacity-30"
        >
          →
        </button>
      </footer>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
