import ShaderBackground from "@/components/ShaderBackground";
import Clock from "@/components/Clock";
import IntroAnimation from "@/components/IntroAnimation";

export default function Home() {
  return (
    <IntroAnimation>
      <main className="px-12 py-10 mx-auto h-screen w-full font-inter flex flex-col">
        <section className="flex justify-between">
          <span className="font-retro uppercase font-bold text-white/80 text-3xl">JM</span>
          <nav>
            <ul className="text-sm text-white flex flex-col gap-2 uppercase text-right">
              <li>Work</li>
              <li>About</li>
              <li>Contact</li>
            </ul>
          </nav>
        </section>

        

        <div className="flex justify-center items-center mx-auto w-4/5 flex-1">
          {/* <h1 className="uppercase text-right text-white text-[15vw] font-retro tracking-tight leading-[11vw]">
            Freelance Creative Developer
          </h1> */}
        </div>
        <section className="flex justify-between items-center text-white/70 text-sm">
          <div className="flex items-center gap-6">
            <Clock />
            <span className="flex items-center gap-2 bg-white text-black rounded-full px-3 py-1">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
              </span>
              Ready for work from {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleString("en-US", { month: "long", year: "numeric" })}
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
              Instagram
            </a>
            <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
              LinkedIn
            </a>
          </div>
        </section>
      </main>

      <ShaderBackground text={["Creative Developer"]}>
        <div className="flex items-center justify-center h-full">
          <h1 className="text-white text-[12vw] font-retro uppercase tracking-tight leading-[0.85]">
            {/* Freelance<br />Creative<br />Developer */}
          </h1>
        </div>
      </ShaderBackground>
    </IntroAnimation>
  );
}
