// Reusable country search input with debounce + dropdown.
// Encapsulates query/results/searching/open state and the 350ms debounce effect.
import { useState, useEffect, useRef } from "react";
import type { CountrySearchResult } from "../../types";
import { searchCountries } from "../../utils/api";
import { Input } from "@/components/ui/input";

interface Props {
  token:       string;
  onSelect:    (code: string) => void;
  placeholder?: string;
  className?:  string;
}

export default function CountrySearchInput({ token, onSelect, placeholder = "Search any country…", className }: Props) {
  const [query,     setQuery]     = useState("");
  const [results,   setResults]   = useState<CountrySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open,      setOpen]      = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try { const hits = await searchCountries(query, token); setResults(hits); setOpen(!!hits.length); }
      catch { /* ignore */ }
      finally { setSearching(false); }
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, token]);

  const pick = (code: string) => { setOpen(false); setQuery(""); setResults([]); onSelect(code); };

  return (
    <div className={`relative ${className ?? ""}`}>
      <Input value={query} onChange={e => setQuery(e.target.value)}
        onFocus={() => query.length >= 2 && results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={searching ? "Searching…" : placeholder}
        className="pl-9" />
      <span className="absolute left-[11px] top-1/2 -translate-y-1/2 text-sm pointer-events-none">
        {searching ? "…" : "🔍"}
      </span>
      {open && results.length > 0 && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-[#161929] border border-[#2d3348] rounded-lg z-[100] overflow-hidden">
          {results.map(c => (
            <button key={c.code} onMouseDown={() => pick(c.code)}
              className="flex items-center gap-2 w-full bg-transparent border-0 border-b border-b-[#1e2130] px-3.5 py-2 cursor-pointer text-slate-100 text-[13px] hover:bg-[#1e2130]">
              <span className="text-lg">{c.flag}</span>
              <span className="font-semibold">{c.name}</span>
              <span className="text-slate-600 text-[11px] ml-auto">{c.region}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
