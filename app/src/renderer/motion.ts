// Motion (GSAP). One authored moment: when a verdict arrives, the ring sweeps and the number counts up on one eased tween, then the verdict word, the note and the evidence cards settle in.
// Everything here is skipped under "reduce motion" (the final state shows at once). GSAP only writes through the CSS object model (element.style), which the page's strict content policy allows.
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useLayoutEffect, useState } from "react";

gsap.registerPlugin(useGSAP);
export const EASE = "power3.out"; // the same family as the CSS --ease (exponential ease-out)
// No matchMedia (a test environment) counts as "no motion" too, so nothing animates where nobody can see it.
export const reducedMotion = () => typeof matchMedia !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches;

// 0 up to `target` on one eased tween; the ring and the number both read it, so they can never disagree. Starts when `play` turns true; with reduced motion (or no play) it is simply the target.
export function useCountUp(target: number, play: boolean, duration = 1.1): number {
  const [n, setN] = useState(() => (play && !reducedMotion() ? 0 : target));
  useLayoutEffect(() => { // in the same phase as the page's timeline, so the ring and the reveal share one clock
    if (!play || reducedMotion()) { setN(target); return; }
    const o = { v: 0 }; setN(0);
    const t = gsap.to(o, { v: target, duration, ease: EASE, onUpdate: () => setN(Math.round(o.v)), onComplete: () => setN(target) });
    return () => { t.kill(); setN(target); };
  }, [target, play, duration]);
  return n;
}

export { gsap, useGSAP };
