// Render-only panel for AI analytics response.

import type { AIResponse } from "@/types";
import { DynChart, SourceList } from "@/components/ui";
import { cn } from "@/lib/utils";

export function AIResultPanel({ result }: { result: AIResponse }) {
  return (
    <div className="bg-white p-5 border-3 border-memphis-black shadow-hard-lg relative">
      <div className="absolute -top-3 -right-3 w-6 h-6 bg-memphis-pink border-3 border-memphis-black" />
      <div className="flex items-center gap-2 mb-3">
        <span
          className={cn(
            "text-[9px] font-black px-2 py-0.5 bg-memphis-pink text-white",
            "border-3 border-memphis-black uppercase tracking-[0.5px]",
          )}
        >
          AI Analysis
        </span>
      </div>

      {result.insight && (
        <p className="mb-4 text-sm text-memphis-black leading-relaxed">
          {result.insight}
        </p>
      )}

      {result.charts?.map((chart) => (
        <div key={chart.id} className="mb-4">
          <p className="mb-1.5 text-[13px] font-black text-memphis-black">
            {chart.title}
          </p>
          {chart.description && (
            <p className="mb-2 text-[11px] text-memphis-black/50">
              {chart.description}
            </p>
          )}
          <DynChart chart={chart} />
        </div>
      ))}

      {result.sources && result.sources.length > 0 && (
        <SourceList sources={result.sources} className="mt-3" />
      )}

      {result.followUps && result.followUps.length > 0 && (
        <div className="mt-2.5">
          <p className="mb-1.5 text-[10px] text-memphis-black/60 uppercase tracking-[0.5px]">
            Follow-ups
          </p>
          <div className="flex flex-wrap gap-1.5">
            {result.followUps.map((question, index) => (
              <span
                key={index}
                className={cn(
                  "text-[11px] text-memphis-black/70 bg-memphis-offwhite",
                  "border-2 border-memphis-black px-2.5 py-1",
                )}
              >
                {question}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
