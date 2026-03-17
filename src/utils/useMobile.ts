import { useState, useEffect } from "react";

/** Returns true when the viewport is narrower than `breakpoint` (default 640px).
 *  Reacts to window resize events so components re-render on orientation change. */
export function useMobile(breakpoint = 640): boolean {
  const [mobile, setMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [breakpoint]);
  return mobile;
}
