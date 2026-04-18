// Country selector block for Analytics mode.

import { useEffect, useMemo, useState } from "react";
import { useMobile } from "@/utils/useMobile";
import { POPULAR_COUNTRIES } from "@/data/suggestions";
import CountrySearchInput from "@/components/shared/CountrySearchInput";
import type { CountryDataset, CountrySearchResult } from "@/types";
import { getCountryHistory } from "@/utils/api";
import { cn } from "@/lib/utils";

interface CountrySelectorProps {
  token: string;
  dataset: CountryDataset | null;
  loading: boolean;
  error: string | null;
  onSelect: (code: string) => void;
}

export function CountrySelector({
  token,
  dataset,
  loading,
  error,
  onSelect,
}: CountrySelectorProps) {
  const isMobile = useMobile();
  const [history, setHistory] = useState<CountrySearchResult[]>([]);

  useEffect(() => {
    let cancelled = false;

    getCountryHistory(token)
      .then((items) => {
        if (cancelled) return;
        setHistory(
          items.slice(0, 6).map((entry) => ({
            code: entry.code,
            name: entry.name,
            flag: entry.flag,
            region: entry.region,
          })),
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [token, dataset?.code]);

  const popularCodes = useMemo(
    () => new Set(POPULAR_COUNTRIES.map((country) => country.code)),
    [],
  );

  const extraHistory = useMemo(
    () => history.filter((entry) => !popularCodes.has(entry.code)),
    [history, popularCodes],
  );

  return (
    <div className="bg-white p-3 sm:p-5 border-3 border-memphis-black shadow-hard-lg mb-5">
      <div className="flex items-center gap-2.5 mb-3 sm:mb-4 flex-wrap">
        <span className="text-[11px] font-black text-memphis-black/60 uppercase tracking-[0.5px]">
          Data Source
        </span>

        {dataset && !loading && (
          <span className="text-xs flex items-center gap-1.5">
            <span className="text-base">{dataset.flag}</span>
            <span className="font-black text-memphis-black">
              {dataset.name}
            </span>
            <span className="text-memphis-black/50">· {dataset.region}</span>
          </span>
        )}

        {loading && (
          <span className="text-xs text-memphis-pink flex items-center gap-1.5">
            <span
              className="w-2 h-2 bg-memphis-pink border-2 border-memphis-black inline-block"
              style={{ animation: "ecPulse 1s steps(1) infinite" }}
            />
            Loading…
          </span>
        )}

        {error && (
          <span className="text-xs text-memphis-orange font-bold">{error}</span>
        )}
      </div>

      <CountrySearchInput token={token} onSelect={onSelect} className="mb-4" />

      <div
        className={
          isMobile
            ? "grid grid-cols-3 gap-1.5"
            : "flex flex-wrap gap-1.5 sm:gap-2"
        }
      >
        {POPULAR_COUNTRIES.slice(0, isMobile ? 6 : undefined).map((country) => (
          <button
            key={country.code}
            onClick={() => onSelect(country.code)}
            className={cn(
              "flex items-center justify-center gap-1 px-2 sm:px-3 py-2",
              "sm:py-1.5 min-h-11 sm:min-h-0 text-[11px] sm:text-xs",
              "cursor-pointer transition-snap border-2 sm:border-3 font-bold",
              "w-full sm:w-auto sm:flex-none sm:min-w-[140px]",
            )}
            style={{
              background:
                dataset?.code === country.code ? "#FF006E" : "#FFFFFF",
              borderColor: "#1A1A2E",
              color: dataset?.code === country.code ? "#FFFFFF" : "#1A1A2E",
              boxShadow:
                dataset?.code === country.code
                  ? isMobile
                    ? "2px 2px 0 #1A1A2E"
                    : "4px 4px 0 #1A1A2E"
                  : "none",
            }}
          >
            <span className="text-sm">{country.flag}</span>
            <span className="hidden sm:inline truncate max-w-[110px]">
              {country.name}
            </span>
            <span className="sm:hidden">{country.code}</span>
          </button>
        ))}

        {!isMobile &&
          extraHistory.map((entry) => (
            <button
              key={entry.code}
              onClick={() => onSelect(entry.code)}
              className={cn(
                "flex items-center gap-1.5 bg-memphis-offwhite border-2",
                "border-dashed border-memphis-black text-memphis-black/60",
                "px-3 py-1.5 text-[11px] cursor-pointer font-medium",
              )}
            >
              <span className="text-[13px]">{entry.flag}</span>
              {entry.name}
            </button>
          ))}
      </div>
    </div>
  );
}
