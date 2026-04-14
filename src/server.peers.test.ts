import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";

let app: { listen: (port: number, hostname?: string, backlog?: number, callback?: () => void) => Server };

const SECRET = "peer_test_secret_2026";
const PORT = 0;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildCatalogPayload() {
  return [
    {},
    [
      {
        iso2Code: "US",
        iso3Code: "USA",
        name: "United States",
        region: { id: "NAC", value: "North America" },
        incomeLevel: { id: "HIC", value: "High income" },
      },
      {
        iso2Code: "CA",
        iso3Code: "CAN",
        name: "Canada",
        region: { id: "NAC", value: "North America" },
        incomeLevel: { id: "HIC", value: "High income" },
      },
      {
        iso2Code: "DE",
        iso3Code: "DEU",
        name: "Germany",
        region: { id: "ECS", value: "Europe & Central Asia" },
        incomeLevel: { id: "HIC", value: "High income" },
      },
      {
        iso2Code: "JP",
        iso3Code: "JPN",
        name: "Japan",
        region: { id: "ECS", value: "Europe & Central Asia" },
        incomeLevel: { id: "HIC", value: "High income" },
      },
      {
        iso2Code: "MX",
        iso3Code: "MEX",
        name: "Mexico",
        region: { id: "NAC", value: "North America" },
        incomeLevel: { id: "UMC", value: "Upper middle income" },
      },
      {
        iso2Code: "BR",
        iso3Code: "BRA",
        name: "Brazil",
        region: { id: "LCN", value: "Latin America & Caribbean" },
        incomeLevel: { id: "UMC", value: "Upper middle income" },
      },
      {
        iso2Code: "RU",
        iso3Code: "RUS",
        name: "Russia",
        region: { id: "SAS", value: "South Asia" },
        incomeLevel: { id: "UMC", value: "Upper middle income" },
      },
      {
        iso2Code: "IN",
        iso3Code: "IND",
        name: "India",
        region: { id: "SAS", value: "South Asia" },
        incomeLevel: { id: "LMC", value: "Lower middle income" },
      },
      {
        iso2Code: "CN",
        iso3Code: "CHN",
        name: "China",
        region: { id: "EAS", value: "East Asia & Pacific" },
        incomeLevel: { id: "UMC", value: "Upper middle income" },
      },
      {
        iso2Code: "ZA",
        iso3Code: "ZAF",
        name: "South Africa",
        region: { id: "SSF", value: "Sub-Saharan Africa" },
        incomeLevel: { id: "UMC", value: "Upper middle income" },
      },
    ],
  ];
}

function buildIndicatorRows(codes: string[], valuesByCode: Record<string, number[]>, year = 2024, indicator = "NY.GDP.MKTP.KD.ZG") {
  const rows = [] as Array<{ country: { value: string }; countryiso3code: string; date: string; value: number; indicator: { id: string; value: string } }>;
  for (const code of codes) {
    for (const [index, value] of valuesByCode[code].entries()) {
      rows.push({
        country: { value: code },
        countryiso3code: code,
        date: `${year - index}`,
        value,
        indicator: { id: indicator, value: indicator },
      });
    }
  }
  return [{}, rows];
}

describe("GET /api/peers/:countryCode", () => {
  let server: Server | null = null;
  let token: string;
  let port: number;
  let base: string;

  const oldFetch = globalThis.fetch;

  async function withEnterprisePlan(userId: string, callback: () => Promise<void> | void) {
    const sqlite = (await import("better-sqlite3" as string)) as {
      default: new (...args: [string]) => { prepare(sql: string): { run(...values: any[]): void }; close(): void };
    };
    const DB_PATH = `${process.cwd()}/data/econChart.db`;
    const db = new sqlite.default(DB_PATH);

    const now = new Date().toISOString();
    const id = `sub_ent_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    db.prepare(
      "INSERT OR IGNORE INTO users (id, email, name, hashed_password, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(userId, `${userId}@test.local`, `User ${userId}`, "hash", now);

    db.prepare(
      "INSERT OR REPLACE INTO subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, userId, `cus_${userId}`, `sub_${userId}`, "enterprise", "active", null, now, now);

    try {
      await callback();
    } finally {
      db.prepare("DELETE FROM subscriptions WHERE user_id = ?").run(userId);
      db.close();
    }
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;

    const peerServer = (await import("../server.js" as string)) as {
      app: {
        listen: (port: number, hostname?: string, backlog?: number, callback?: () => void) => Server;
      };
    };
    app = peerServer.app;

    const jwt = (await import("jsonwebtoken" as string)) as {
      sign(payload: unknown, secret: string, options?: { expiresIn?: string | number }): string;
    };

    token = jwt.sign(
      { id: "user_1", email: "test@example.com", name: "Test User", isGuest: false },
      SECRET,
      { expiresIn: "7d" },
    );
    server = app.listen(PORT);
    if (!server) {
      throw new Error("App failed to start");
    }

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("App address not ready");
    }

    port = Number(address.port);
    base = `http://127.0.0.1:${port}`;

    const stubFetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);

      if (url.startsWith(base)) {
        return oldFetch(url, _init);
      }

      if (url.includes("api.worldbank.org/v2/country?format=json&per_page=500")) {
        return jsonResponse(buildCatalogPayload());
      }

      if (url.includes("api.worldbank.org/v2/country/")) {
        const match = /country\/([^/]+)\/indicator\/([^?]+)/.exec(url);
        if (!match) return jsonResponse([], 404);

        const rawCodes = match[1];
        const indicator = decodeURIComponent(match[2]);
        const codes = rawCodes.split(";");

        const valuesByCode: Record<string, number[]> = {
          US: [1.2, 1.8],
          CA: [0.9, 1.1],
          USA: [1.2, 1.8],
          CAN: [0.9, 1.1],
          DE: [2.4, 2.6],
          JP: [1.1, 1.3],
          MEX: [3.2, 3.4],
          BR: [2.1, 2.9],
          RU: [1.4, 2.0],
          IN: [2.8, 3.1],
          CN: [7.1, 7.6],
          ZA: [1.7, 2.1],
        };

        const rows = buildIndicatorRows(codes, valuesByCode, 2024, indicator);
        return jsonResponse(rows);
      }

      return jsonResponse({ error: "Unexpected fetch url" }, 404);
    };

    globalThis.fetch = stubFetch;
  });

  afterAll(() => {
    if (server !== null) server.close();
    globalThis.fetch = oldFetch;
  });

  it("returns peers summary for valid region peer type", async () => {
    const res = await fetch(`${base}/api/peers/DE?groupType=region&metric=gdp_growth`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.metric).toBe("gdp_growth");
    expect(body.summary.groupType).toBe("region");
    expect(Array.isArray(body.peers)).toBe(true);
    expect(body.peers.some((p: { isTarget: boolean }) => p.isTarget)).toBe(true);
  });

  it("rejects bad metric with schema", async () => {
    const res = await fetch(`${base}/api/peers/US?groupType=income&metric=bad-metric`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
  });

  it("enforces free peer cap for region group", async () => {
    const res = await fetch(`${base}/api/peers/US?groupType=region&metric=gdp`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toContain("Peer comparison limit reached");
  });

  it("supports brics peer grouping", async () => {
    await withEnterprisePlan("user_1", async () => {
      const res = await fetch(`${base}/api/peers/BR?groupType=brics&metric=gdp`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.summary.groupType).toBe("brics");
      expect(body.summary.peerCount).toBe(5);
      expect(body.peers.some((p: { code: string; isTarget: boolean }) => p.code === "BR" && p.isTarget)).toBe(true);
    });
  });

  it("lets enterprise plan bypass peer cap", async () => {
    await withEnterprisePlan("user_1", async () => {
      const res = await fetch(`${base}/api/peers/US?groupType=income&metric=gdp`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.summary.groupType).toBe("income");
      expect(body.summary.peerCount).toBe(4);
      expect(Array.isArray(body.peers)).toBe(true);
    });
  });
});
