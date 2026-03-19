// Reusable country search input with debounce + dropdown.
// Encapsulates query/results/searching/open state and the 350ms debounce effect.
import { useState, useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { CountrySearchResult } from "../../types";
import { searchCountries } from "../../utils/api";
import { Input } from "@/components/ui/input";

interface Props {
  token:       string;
  onSelect:    (code: string) => void;
  placeholder?: string;
  style?:      CSSProperties;
}

export default function CountrySearchInput({ token, onSelect, placeholder = "Search any country…", style }: Props) {
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
    <div style={{ position: "relative", ...style }}>
      <Input value={query} onChange={e => setQuery(e.target.value)}
        onFocus={() => query.length >= 2 && results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={searching ? "Searching…" : placeholder}
        className="pl-9" />
      <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 14, pointerEvents: "none" }}>
        {searching ? "…" : "🔍"}
      </span>
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#161929", border: "1px solid #2d3348", borderRadius: 8, zIndex: 100, overflow: "hidden" }}>
          {results.map(c => (
            <button key={c.code} onMouseDown={() => pick(c.code)}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "transparent", border: "none", borderBottom: "1px solid #1e2130", padding: "8px 14px", cursor: "pointer", color: "#e2e8f0", fontSize: 13 }}
              onMouseEnter={e => (e.currentTarget.style.background = "#1e2130")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <span style={{ fontSize: 18 }}>{c.flag}</span>
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <span style={{ color: "#475569", fontSize: 11, marginLeft: "auto" }}>{c.region}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
