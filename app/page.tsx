import ShaderBackground from "@/components/ShaderBackground";
import Clock from "@/components/Clock";

export default function Home() {
  return (
    <>
      <main className="px-12 py-10 mx-auto h-screen w-full font-inter flex flex-col">
        <section className="">
          <span className="font-retro uppercase text-white text-4xl tracking-tighter">JM</span>
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
              Ready for work from July 2026
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

      <ShaderBackground />
    </>
  );
}
