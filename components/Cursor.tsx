"use client";

import { useEffect, useRef } from "react";

/**
 * The site's pointer: a small orange square, the same orange as the
 * availability dot and the same square as the nav markers.
 *
 * It is a little mass on a spring rather than a sprite glued to the mouse. It
 * trails the pointer, overshoots a touch when the pointer stops, and while it
 * moves it stretches along its velocity — keeping its area, so it reads as
 * one object being pulled rather than one being resized. Its size and
 * rotation ride springs of their own, so every change of state is carried by
 * the same motion instead of a CSS easing curve.
 *
 * - over a link or button it turns 45° into a hollow diamond, exactly as the
 *   nav markers do on hover;
 * - inside the open portal's rim it is a hollow square, and a small solid one
 *   while the sheet is being dragged (SiteCanvas reports that through
 *   `data-cursor` on <html>, since only it knows where the rim is).
 *
 * Touch and pen-only devices never see any of this: the stylesheet only hides
 * the system cursor under (hover: hover) and (pointer: fine).
 */

/** resting edge length, px */
const SIZE = 8;
const LINK_SIZE = 26;
const GRAB_SIZE = 34;
const GRABBING_SIZE = 14;
const PRESSED = 0.8;

/**
 * Spring constants: natural frequency (rad/s) and damping ratio. Below 1 the
 * spring overshoots before it settles; the follow is just under-damped enough
 * to be felt, the shape a little more so.
 */
const FOLLOW = { w: 30, z: 0.72 };
const SHAPE = { w: 24, z: 0.55 };
const TURN = { w: 20, z: 0.7 };

/** how far motion can stretch the square: 1 + STRETCH at full speed */
const STRETCH = 0.45;
/** px/s at which the stretch is about two thirds of the way there */
const STRETCH_SPEED = 1800;

/** fixed integration step, so the springs behave the same at any refresh rate */
const STEP = 1 / 240;

type Spring = { x: number; v: number; target: number };

function stepSpring(s: Spring, { w, z }: { w: number; z: number }, dt: number) {
  s.v += (w * w * (s.target - s.x) - 2 * z * w * s.v) * dt;
  s.x += s.v * dt;
}

const settled = (s: Spring, eps: number) =>
  Math.abs(s.target - s.x) < eps && Math.abs(s.v) < eps * 10;

export default function Cursor() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const x: Spring = { x: 0, v: 0, target: 0 };
    const y: Spring = { x: 0, v: 0, target: 0 };
    const size: Spring = { x: SIZE, v: 0, target: SIZE };
    const turn: Spring = { x: 0, v: 0, target: 0 };

    let link = false;
    let down = false;
    let seen = false;
    let raf = 0;
    let last = 0;
    let carry = 0;

    /** What the square should become, from what is under it. */
    function retarget() {
      const portal = document.documentElement.dataset.cursor;
      let s = SIZE;
      let r = 0;
      let hollow = false;
      if (portal === "grabbing") s = GRABBING_SIZE;
      else if (portal === "grab") {
        s = GRAB_SIZE;
        hollow = true;
      } else if (link) {
        s = LINK_SIZE;
        r = Math.PI / 4;
        hollow = true;
      }
      size.target = s * (down ? PRESSED : 1);
      turn.target = r;
      el!.toggleAttribute("data-hollow", hollow);
      wake();
    }

    function render() {
      const vx = x.v;
      const vy = y.v;
      const speed = still ? 0 : Math.hypot(vx, vy);
      const k = 1 + STRETCH * (1 - Math.exp(-speed / STRETCH_SPEED));
      const dir = Math.atan2(vy, vx);
      const s = size.x;
      el!.style.width = `${s}px`;
      el!.style.height = `${s}px`;
      el!.style.transform =
        `translate3d(${x.x - s / 2}px, ${y.x - s / 2}px, 0) ` +
        `rotate(${dir}rad) scale(${k}, ${1 / k}) rotate(${-dir}rad) ` +
        `rotate(${turn.x}rad)`;
    }

    function frame(now: number) {
      raf = 0;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      if (still) {
        for (const s of [x, y, size, turn]) {
          s.x = s.target;
          s.v = 0;
        }
      } else {
        carry += dt;
        while (carry >= STEP) {
          stepSpring(x, FOLLOW, STEP);
          stepSpring(y, FOLLOW, STEP);
          stepSpring(size, SHAPE, STEP);
          stepSpring(turn, TURN, STEP);
          carry -= STEP;
        }
      }
      render();

      const resting =
        settled(x, 0.05) && settled(y, 0.05) && settled(size, 0.05) && settled(turn, 0.002);
      if (!resting) raf = requestAnimationFrame(frame);
    }

    function wake() {
      if (raf) return;
      last = performance.now();
      carry = 0;
      raf = requestAnimationFrame(frame);
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x.target = e.clientX;
      y.target = e.clientY;
      // first sight, or back from outside the window: appear where the
      // pointer is rather than flying in from wherever it was last
      if (!seen) {
        x.x = x.target;
        y.x = y.target;
        x.v = y.v = 0;
        seen = true;
        el!.toggleAttribute("data-visible", true);
      }
      // the portal state changes as the pointer crosses the rim
      retarget();
    };

    const onOver = (e: PointerEvent) => {
      link = !!(e.target as Element | null)?.closest?.(
        "a, button:not(:disabled), [role='button'], label, summary"
      );
      retarget();
    };

    const onDown = () => {
      down = true;
      retarget();
    };
    const onUp = () => {
      down = false;
      retarget();
    };

    // relatedTarget is null only when the pointer leaves the window itself
    const onOut = (e: PointerEvent) => {
      if (e.relatedTarget) return;
      seen = false;
      el.toggleAttribute("data-visible", false);
    };

    render();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointerout", onOut);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointerout", onOut);
    };
  }, []);

  return <div ref={ref} className="site-cursor" aria-hidden="true" />;
}
