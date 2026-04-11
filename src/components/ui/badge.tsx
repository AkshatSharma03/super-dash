import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* Memphis Design Badges — Geometric shapes, thick borders, bold colors */

const badgeVariants = cva(
  "inline-flex items-center border-3 px-3 py-1 text-xs font-black uppercase tracking-wider transition-snap focus:outline-none focus:ring-3 focus:ring-memphis-black",
  {
    variants: {
      variant: {
        /* Primary — Pink with corner accent */
        default:     "border-memphis-black bg-memphis-pink text-white shadow-hard-sm relative overflow-hidden",
        /* Secondary — Cyan */
        secondary:   "border-memphis-black bg-memphis-cyan text-memphis-black shadow-hard-cyan",
        /* Destructive — Orange */
        destructive: "border-memphis-black bg-memphis-orange text-white shadow-hard-orange",
        /* Success — Lime */
        success:     "border-memphis-black bg-memphis-lime text-memphis-black shadow-hard-sm",
        /* Warning — Yellow */
        warning:     "border-memphis-black bg-memphis-yellow text-memphis-black shadow-hard-sm",
        /* Outline — White bg, thick border */
        outline:     "border-memphis-black bg-white text-memphis-black shadow-hard-sm",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div 
      className={cn(badgeVariants({ variant }), className)} 
      {...props} 
    />
  );
}

export { Badge, badgeVariants };
