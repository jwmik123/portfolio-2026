"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import SiteCanvas, { type PortalProject } from "@/components/SiteCanvas";

interface WorkPortalApi {
  isOpen: boolean;
  openWork: () => void;
  closeWork: () => void;
  toggleWork: () => void;
}

const WorkPortalContext = createContext<WorkPortalApi | null>(null);

export function useWorkPortal() {
  const ctx = useContext(WorkPortalContext);
  if (!ctx) {
    throw new Error("useWorkPortal must be used inside <WorkPortalProvider>");
  }
  return ctx;
}

/**
 * There is no overlay here. The page's background, its type, the hole and the
 * project all live in one WebGPU pipeline inside <SiteCanvas>, so the hole is
 * opened *in* the site rather than drawn on top of it. All that is left for
 * the DOM is the chrome, which steps back out of the way.
 */
export default function WorkPortalProvider({
  children,
  projects,
  text,
}: {
  children: ReactNode;
  /** stable identity: WorkPortal rebakes every atlas when this changes */
  projects: PortalProject[];
  text?: string[];
}) {
  const [isOpen, setOpen] = useState(false);

  const openWork = useCallback(() => setOpen(true), []);
  const closeWork = useCallback(() => setOpen(false), []);
  const toggleWork = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <WorkPortalContext.Provider
      value={{ isOpen, openWork, closeWork, toggleWork }}
    >
      <SiteCanvas
        projects={projects}
        text={text}
        open={isOpen}
        onClose={closeWork}
      />

      <div
        className="transition-opacity duration-700"
        style={{ opacity: isOpen ? 0.4 : 1 }}
      >
        {children}
      </div>
    </WorkPortalContext.Provider>
  );
}

/** The nav item that opens the hole. */
export function WorkTrigger({
  children = "Work",
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const { isOpen, toggleWork } = useWorkPortal();
  return (
    <button
      type="button"
      onClick={toggleWork}
      aria-expanded={isOpen}
      className={className}
    >
      {children}
    </button>
  );
}
