import Clock from "@/components/Clock";
import IntroAnimation from "@/components/IntroAnimation";
import WorkPortalProvider, {
  WorkTrigger,
} from "@/components/WorkPortalProvider";
import { getProjects } from "@/lib/projects";
import RollText from "@/components/RollText";

const NAV_LINK = "group flex items-baseline justify-end gap-2 outline-none";

function NavLabel({ children }: { children: string }) {
  return (
    <>
      <RollText>{children}</RollText>
      <span
        aria-hidden
        className="text-white/50 transition-transform duration-500 ease-[cubic-bezier(0.625,0.05,0,1)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white group-focus-visible:-translate-y-0.5 group-focus-visible:translate-x-0.5"
      >
        ↗
      </span>
    </>
  );
}

export default async function Home() {
  const projects = await getProjects();

  return (
    <WorkPortalProvider projects={projects} text={["Creative Developer"]}>
      <IntroAnimation>
        <main className="px-12 py-10 mx-auto h-screen w-full font-mono text-[11px] uppercase tracking-[0.15em] flex flex-col">
          <section className="grid grid-cols-[1fr_auto_1fr] items-center">
            <span className="font-retro uppercase font-bold text-white/80 text-3xl tracking-normal">
              JM
            </span>
            <span className="justify-self-center flex items-center gap-2 bg-white text-black rounded-full px-3 py-1 tracking-normal">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-500 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-orange-500" />
              </span>
              Ready for work from{" "}
              {new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000
              ).toLocaleString("en-US", { month: "long", year: "numeric" })}
            </span>
            <nav className="justify-self-end">
              <ul className="flex flex-col gap-2 text-white">
                <li>
                  <WorkTrigger className={NAV_LINK}>
                    <NavLabel>My Work</NavLabel>
                  </WorkTrigger>
                </li>
                <li>
                  <a href="mailto:joel@mikdevelopment.nl" className={NAV_LINK}>
                    <NavLabel>joel@mikdevelopment.nl</NavLabel>
                  </a>
                </li>
              </ul>
            </nav>
          </section>

          <div className="flex justify-center items-center mx-auto w-4/5 flex-1" />

          <section className="flex justify-between items-center text-white/60">
            <Clock />
            <div className="flex items-center gap-6">
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                className="group transition-colors hover:text-white"
              >
                <RollText>Instagram</RollText>
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noopener noreferrer"
                className="group transition-colors hover:text-white"
              >
                <RollText>LinkedIn</RollText>
              </a>
            </div>
          </section>
        </main>
      </IntroAnimation>
    </WorkPortalProvider>
  );
}
