import type { PortalProject } from "@/components/SiteCanvas";

/**
 * Module-level constant on purpose: WorkPortal bakes every project's
 * screenshots into a GPU texture when this array's identity changes.
 */
export const projects: PortalProject[] = [
  {
    title: "Aurora",
    meta: "Brand · Webdesign · 2025",
    images: [
      "/projects/aurora-1.svg",
      "/projects/aurora-2.svg",
      "/projects/aurora-3.svg",
      "/projects/aurora-4.svg",
    ],
  },
  {
    title: "Monolith",
    meta: "Art direction · Next.js · 2025",
    images: [
      "/projects/monolith-1.svg",
      "/projects/monolith-2.svg",
      "/projects/monolith-3.svg",
      "/projects/monolith-4.svg",
    ],
  },
  {
    title: "Kinetic",
    meta: "WebGL · Motion · 2026",
    images: [
      "/projects/kinetic-1.svg",
      "/projects/kinetic-2.svg",
      "/projects/kinetic-3.svg",
      "/projects/kinetic-4.svg",
    ],
  },
];
