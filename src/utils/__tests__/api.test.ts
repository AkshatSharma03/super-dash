import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiDataBatch, getApiDataByCountry } from "../api";

describe("public data API client query params", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends snake_case year params for country requests", async () => {
    const fetchMock = vi.fn(async (..._args: [RequestInfo | URL, RequestInit?]) =>
      new Response(JSON.stringify({ country: {}, period: {}, indicators: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getApiDataByCountry("test_token", "US", {
      indicators: "gdp",
      startYear: 2018,
      endYear: 2022,
    });

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeTruthy();
    const url = String(firstCall?.[0] ?? "");
    const init = (firstCall?.[1] ?? {}) as RequestInit;
    expect(url).toContain("/api/data/US?");
    expect(url).toContain("start_year=2018");
    expect(url).toContain("end_year=2022");
    expect(url).not.toContain("startYear=");
    expect(url).not.toContain("endYear=");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test_token");
  });

  it("sends snake_case year params for batch requests", async () => {
    const fetchMock = vi.fn(async (..._args: [RequestInfo | URL, RequestInit?]) =>
      new Response(JSON.stringify({
        period: {},
        requestedIndicators: [],
        requestedCountries: [],
        countries: [],
        failed: [],
        invalid: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getApiDataBatch("test_token", {
      countries: "US,CN",
      indicators: "gdp",
      startYear: 2010,
      endYear: 2014,
    });

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeTruthy();
    const url = String(firstCall?.[0] ?? "");
    expect(url).toContain("/api/data/batch?");
    expect(url).toContain("start_year=2010");
    expect(url).toContain("end_year=2014");
    expect(url).not.toContain("startYear=");
    expect(url).not.toContain("endYear=");
  });
});
