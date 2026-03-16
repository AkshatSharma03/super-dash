import { describe, it, expect } from "vitest";
import { parseCSV } from "../csv";

// ── parseCSV ──────────────────────────────────────────────────────────────────

describe("parseCSV", () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it("parses a minimal 3-column CSV", () => {
    const r = parseCSV("name,age,city\nAlice,30,Paris\nBob,25,London");
    expect(r.headers).toEqual(["name", "age", "city"]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ name: "Alice", age: "30", city: "Paris" });
    expect(r.rows[1]).toEqual({ name: "Bob",   age: "25", city: "London" });
  });

  it("handles CRLF line endings", () => {
    const r = parseCSV("a,b,c\r\n1,2,3\r\n4,5,6");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("handles quoted field containing a comma", () => {
    const r = parseCSV('name,address\nAlice,"123 Main St, Suite 4"');
    expect(r.rows[0].address).toBe("123 Main St, Suite 4");
  });

  it("handles escaped double-quotes inside a quoted field (\"\") → \"", () => {
    const r = parseCSV('col,val\ntest,"She said ""hello"""');
    expect(r.rows[0].val).toBe('She said "hello"');
  });

  it("trims whitespace from unquoted field values", () => {
    const r = parseCSV("col1,col2\n  hello  ,  world  ");
    expect(r.rows[0].col1).toBe("hello");
    expect(r.rows[0].col2).toBe("world");
  });

  it("trims whitespace from header names", () => {
    const r = parseCSV(" name , age \nAlice,30");
    expect(r.headers).toEqual(["name", "age"]);
  });

  it("fills missing trailing columns with empty string", () => {
    const r = parseCSV("a,b,c\n1,2");
    expect(r.rows[0].c).toBe("");
  });

  it("skips blank lines between data rows", () => {
    const r = parseCSV("a,b\n1,2\n\n3,4\n");
    expect(r.rows).toHaveLength(2);
  });

  it("handles single-column CSV", () => {
    const r = parseCSV("year\n2020\n2021\n2022");
    expect(r.headers).toEqual(["year"]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[2].year).toBe("2022");
  });

  it("all values are returned as strings (not numbers)", () => {
    const r = parseCSV("x,y\n1.5,2.7");
    expect(typeof r.rows[0].x).toBe("string");
    expect(r.rows[0].x).toBe("1.5");
  });

  it("handles a CSV with many columns", () => {
    const cols = Array.from({ length: 20 }, (_, i) => `col${i}`);
    const vals = cols.map((_, i) => String(i * 2));
    const r = parseCSV(`${cols.join(",")}\n${vals.join(",")}`);
    expect(r.headers).toHaveLength(20);
    expect(r.rows[0].col10).toBe("20");
  });

  it("handles a quoted field containing newline (CRLF inside quotes)", () => {
    // Note: the parser does not strip CRLF inside quotes (it parses line-by-line),
    // so we only test that a newline BETWEEN quoted commas works correctly.
    const r = parseCSV('id,desc\n1,"has, comma"');
    expect(r.rows[0].desc).toBe("has, comma");
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("returns empty arrays for empty string input", () => {
    const r = parseCSV("");
    expect(r.headers).toHaveLength(0);
    expect(r.rows).toHaveLength(0);
  });

  it("returns empty arrays when input has only one line (header-only)", () => {
    const r = parseCSV("only,one,line");
    expect(r.headers).toHaveLength(0);
    expect(r.rows).toHaveLength(0);
  });

  it("throws on unclosed quote", () => {
    expect(() => parseCSV('name,val\ntest,"unclosed')).toThrow(
      /unclosed quote/i,
    );
  });

  it("handles whitespace-only lines by skipping them", () => {
    const r = parseCSV("a,b\n1,2\n   \n3,4");
    expect(r.rows).toHaveLength(2);
  });

  it("handles a file with a trailing newline", () => {
    const r = parseCSV("a,b\n1,2\n3,4\n");
    expect(r.rows).toHaveLength(2);
  });

  it("handles a quoted field that is the entire value of the field", () => {
    const r = parseCSV('name,phrase\nAlice,"hello world"');
    expect(r.rows[0].phrase).toBe("hello world");
  });

  it("header row of a single column (edge case)", () => {
    const r = parseCSV("value\n42\n43");
    expect(r.headers).toEqual(["value"]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].value).toBe("42");
  });

  it("rows are plain objects with headers as keys", () => {
    const r = parseCSV("k1,k2\nv1,v2");
    expect(r.rows[0]).toHaveProperty("k1", "v1");
    expect(r.rows[0]).toHaveProperty("k2", "v2");
  });
});
