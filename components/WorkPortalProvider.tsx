"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import SiteCanvas, { type PortalProject } from "@/components/SiteCanvas";
import WorkSlides from "@/components/WorkSlides";

/** Below this the work is shown as slides rather than through the portal. */
const PHONE_QUERY = "(max-width: 767px)";

function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function useIsPhone() {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false
  );
}

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
  const isPhone = useIsPhone();

  const openWork = useCallback(() => setOpen(true), []);
  const closeWork = useCallback(() => setOpen(false), []);
  const toggleWork = useCallback(() => setOpen((v) => !v), []);

  return (
    <WorkPortalContext.Provider
      value={{ isOpen, openWork, closeWork, toggleWork }}
    >
      <SiteCanvas
        projects={projects}
        text={text}
        open={isOpen && !isPhone}
        onClose={closeWork}
      />

      <WorkSlides
        projects={projects}
        open={isOpen && isPhone}
        onClose={closeWork}
      />

      {/* touch-action: a finger on the page stirs the water, it never scrolls */}
      <div
        className="touch-none transition-opacity duration-700"
        style={{ opacity: isOpen ? (isPhone ? 0 : 0.4) : 1 }}
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
