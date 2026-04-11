import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* Memphis Design Buttons — Thick borders, hard shadows, sharp corners, snappy */
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap text-sm font-bold uppercase tracking-wide transition-snap focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-memphis-black disabled:pointer-events-none disabled:opacity-60 active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-sm",
  {
    variants: {
      variant: {
        /* Primary — Hot pink with hard black shadow */
        default:     "bg-memphis-pink text-white border-3 border-memphis-black shadow-hard hover:shadow-hard-lg hover:-translate-x-[1px] hover:-translate-y-[1px]",
        /* Destructive — Orange with shadow */
        destructive: "bg-memphis-orange text-white border-3 border-memphis-black shadow-hard-orange hover:shadow-hard-lg hover:-translate-x-[1px] hover:-translate-y-[1px]",
        /* Outline — White bg, thick border */
        outline:     "bg-white text-memphis-black border-3 border-memphis-black shadow-hard hover:bg-memphis-cyan hover:shadow-hard-cyan active:shadow-hard-sm",
        /* Secondary — Cyan */
        secondary:   "bg-memphis-cyan text-memphis-black border-3 border-memphis-black shadow-hard-cyan hover:shadow-hard-lg hover:-translate-x-[1px] hover:-translate-y-[1px]",
        /* Ghost — No shadow, underline on hover */
        ghost:       "bg-transparent text-memphis-black border-b-3 border-transparent hover:border-memphis-pink hover:text-memphis-pink shadow-none active:translate-none",
        /* Link — Text only with thick underline */
        link:        "bg-transparent text-memphis-pink underline decoration-4 underline-offset-4 hover:decoration-memphis-black shadow-none active:translate-none",
      },
      size: {
        default: "h-10 px-6 py-2",
        sm:      "h-10 px-4 text-xs sm:h-8",
        lg:      "h-12 px-8 text-base",
        icon:    "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
