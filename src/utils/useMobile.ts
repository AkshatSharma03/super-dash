import { useState, useEffect } from "react";

/** Returns true when the viewport is narrower than `breakpoint` (default 640px).
 *  Reacts to window resize events so components re-render on orientation change. */
export function useMobile(breakpoint = 640): boolean {
  const [mobile, setMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < breakpoint;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setMobile(window.innerWidth < breakpoint);
    handler();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [breakpoint]);

  return mobile;
}
