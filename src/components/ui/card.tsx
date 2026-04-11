import * as React from "react";
import { cn } from "@/lib/utils";

/* Memphis Design Cards — Thick borders, hard shadows, corner circles, extra padding */

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div 
      ref={ref} 
      className={cn(
        "relative bg-white text-memphis-black border-3 border-memphis-black shadow-hard-lg overflow-hidden",
        className
      )} 
      {...props} 
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div 
      ref={ref} 
      className={cn(
        "flex flex-col space-y-2 p-6 border-b-3 border-memphis-black bg-memphis-offwhite",
        className
      )} 
      {...props} 
    />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div 
      ref={ref} 
      className={cn(
        "text-base font-black leading-tight tracking-tight text-memphis-black uppercase",
        className
      )} 
      {...props} 
    />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div 
      ref={ref} 
      className={cn(
        "text-sm font-semibold text-memphis-black/70",
        className
      )} 
      {...props} 
    />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div 
      ref={ref} 
      className={cn("p-6", className)} 
      {...props} 
    />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div 
      ref={ref} 
      className={cn(
        "flex items-center p-6 border-t-3 border-memphis-black bg-memphis-offwhite",
        className
      )} 
      {...props} 
    />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
