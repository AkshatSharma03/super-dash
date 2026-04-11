import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/* Memphis Design Input — Thick bottom border, no radius, bold focus */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-12 sm:h-11 w-full bg-transparent px-0 py-2 text-base sm:text-sm font-semibold text-memphis-black border-0 border-b-3 border-memphis-black/30 placeholder:text-memphis-black/40 focus-visible:outline-none focus-visible:border-b-memphis-pink focus-visible:border-b-4 disabled:cursor-not-allowed disabled:opacity-60 transition-snap",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
