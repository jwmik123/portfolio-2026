/**
 * Text that rolls up one character at a time and is replaced by a copy of
 * itself when the nearest `group` ancestor is hovered. Same staggered roll as
 * the Clock, but pure CSS so it works in server components.
 */
const STAGGER = 0.012; // seconds between characters
const EASE = "cubic-bezier(0.625, 0.05, 0, 1)";

export default function RollText({ children }: { children: string }) {
  return (
    <span className="relative inline-flex" aria-label={children}>
      {Array.from(children).map((char, i) => (
        <span
          key={i}
          aria-hidden
          className="inline-block h-[1.3em] overflow-hidden leading-[1.3]"
        >
          <span
            className="block transition-transform duration-600 group-hover:-translate-y-1/2 group-focus-visible:-translate-y-1/2"
            style={{
              transitionDelay: `${i * STAGGER}s`,
              transitionTimingFunction: EASE,
            }}
          >
            <span className="block h-[1.3em] whitespace-pre">{char}</span>
            <span className="block h-[1.3em] whitespace-pre">{char}</span>
          </span>
        </span>
      ))}
    </span>
  );
}
