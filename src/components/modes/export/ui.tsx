// Small reusable UI blocks for Export mode.

import type { ReactNode } from "react";
import type { CountryDataset } from "@/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ExportBtnProps {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  full?: boolean;
}

export function ExportBtn({
  label,
  icon,
  onClick,
  disabled,
  full,
}: ExportBtnProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={`gap-1.5 text-xs font-medium ${full ? "w-full justify-start" : ""}`}
    >
      <span>{icon}</span>
      {label}
    </Button>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-black text-memphis-black/50 uppercase tracking-[0.8px] mt-5 mb-2">
      {children}
    </p>
  );
}

interface PanelProps {
  title: string;
  icon: string;
  color: string;
  dataset: CountryDataset | null;
  empty: string;
  children: ReactNode;
}

export function Panel({
  title,
  icon,
  color,
  dataset,
  empty,
  children,
}: PanelProps) {
  return (
    <div
      className={cn(
        "bg-white border-4 border-memphis-black px-4 sm:px-6 py-4 sm:py-5",
        "flex-1 min-w-0 shadow-hard relative",
      )}
    >
      <div
        className="absolute -top-2 -right-2 w-5 h-5"
        style={{ background: color, border: "3px solid #1A1A2E" }}
      />

      <div className="flex items-center gap-3 mb-4">
        <div
          className={cn(
            "w-8 h-8 flex items-center justify-center text-base shrink-0",
            "border-3 border-memphis-black shadow-hard-sm",
          )}
          style={{ background: color }}
        >
          {icon}
        </div>
        <div>
          <p className="text-sm font-black text-memphis-black uppercase tracking-wide">
            {title}
          </p>
          {dataset ? (
            <p className="text-[11px] text-memphis-black/60 font-medium">
              {dataset.flag} {dataset.name} · {dataset.gdpData.length} years of
              data
            </p>
          ) : (
            <p className="text-[11px] text-memphis-black/50 font-medium">
              {empty}
            </p>
          )}
        </div>

        {dataset && (
          <div
            className={cn(
              "ml-auto px-2 py-0.5 border-2 border-memphis-black",
              "text-[10px] font-black tracking-[0.4px] bg-white",
              "shadow-hard-sm uppercase",
            )}
            style={{ color }}
          >
            LOADED
          </div>
        )}
      </div>

      {children}
    </div>
  );
}
