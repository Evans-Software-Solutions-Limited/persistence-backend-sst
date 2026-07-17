import { useEffect, useRef, useState } from "react";

/**
 * Reveal-on-scroll for elements tagged `[data-reveal]` inside `ref`.
 * Mirrors the prototype: IntersectionObserver adds `.in`; anything already in
 * view on mount reveals immediately; a fallback timer force-reveals everything
 * so content can never get stuck hidden. Respects `prefers-reduced-motion`
 * (the CSS only hides elements when motion is allowed, so this is purely
 * additive there).
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (els.length === 0) return;

    const show = (el: HTMLElement) => el.classList.add("in");

    if (!("IntersectionObserver" in window)) {
      els.forEach(show);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            show(e.target as HTMLElement);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.14 },
    );

    els.forEach((el) => io.observe(el));
    // Reveal anything already near the top of the viewport on mount.
    els.forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) show(el);
    });

    // Safety net: if the observer never fires (edge browsers, layout quirks),
    // force everything visible after a short delay.
    const fallback = window.setTimeout(() => {
      els.forEach(show);
    }, 3000);

    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  return ref;
}

/**
 * Auto-advances an index 0..count-1 on an interval for the phone-mock screen
 * crossfade. Pauses while `paused` is true (hover) and stays on the first
 * screen when the user prefers reduced motion. Returns the active index and a
 * hover-pause setter.
 */
export function useScreenCycle(count: number, intervalMs = 4200) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (count <= 1 || paused) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % count),
      intervalMs,
    );
    return () => window.clearInterval(id);
  }, [count, paused, intervalMs]);

  return { index, setPaused };
}

/** True once the window has scrolled past `threshold` px (default 40). */
export function useScrolled(threshold = 40) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return scrolled;
}
