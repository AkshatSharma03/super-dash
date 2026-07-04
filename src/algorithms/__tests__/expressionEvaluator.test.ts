import { describe, expect, it } from "vitest";
import { evaluateMetric, validateExpression, KNOWN_VARIABLES } from "../expressionEvaluator";

const sampleData = {
  gdpData: [
    { year: 2020, gdp_bn: 100, gdp_growth: 2, gdp_per_capita: 1000 },
    { year: 2021, gdp_bn: 120, gdp_growth: 3, gdp_per_capita: 1100 },
    { year: 2022, gdp_bn: null, gdp_growth: null, gdp_per_capita: null },
  ],
  exportData: [
    { year: 2020, total: 20 },
    { year: 2021, total: 30 },
    { year: 2023, total: 5 },
  ],
  importData: [
    { year: 2020, total: 10 },
    { year: 2021, total: 15 },
    { year: 2023, total: 8 },
  ],
};

describe("expressionEvaluator", () => {
  it("validates expressions and returns normalized variables", () => {
    expect(validateExpression("GDP + exports * 2")).toEqual({
      valid: true,
      variables: ["gdp", "exports"],
    });
  });

  it("rejects empty expressions, unexpected characters, and mismatched parentheses", () => {
    expect(validateExpression("").valid).toBe(false);
    expect(validateExpression("gdp + @").error?.message).toContain("Unexpected character");
    expect(validateExpression("(gdp + exports").error?.message).toBe("Mismatched parentheses");
    expect(validateExpression("gdp + exports)").error?.message).toBe("Mismatched parentheses");
  });

  it("evaluates arithmetic with precedence and parentheses across all available years", () => {
    const result = evaluateMetric("(exports - imports) / gdp * 100", sampleData);

    expect(result.name).toBe("(exports - imports) / gdp * 100");
    expect(result.unit).toBe("custom");
    expect(result.values).toEqual([
      { year: 2020, value: 10 },
      { year: 2021, value: 12.5 },
      { year: 2022, value: null },
      { year: 2023, value: null },
    ]);
  });

  it("supports derived variables for trade balance and openness", () => {
    const balance = evaluateMetric("trade_balance", sampleData);
    const openness = evaluateMetric("trade_openness", sampleData);

    expect(balance.values.find(v => v.year === 2021)?.value).toBe(15);
    expect(openness.values.find(v => v.year === 2020)?.value).toBe(30);
  });

  it("returns null for division by zero or missing variables instead of throwing", () => {
    const divZero = evaluateMetric("gdp / 0", sampleData);
    const unknown = evaluateMetric("unknown_metric + gdp", sampleData);

    expect(divZero.values.every(v => v.value === null)).toBe(true);
    expect(unknown.values.every(v => v.value === null)).toBe(true);
  });

  it("documents known variables for the custom metric UI", () => {
    expect(KNOWN_VARIABLES.gdp.label).toBe("GDP");
    expect(KNOWN_VARIABLES.trade_openness.description).toContain("Exports + Imports");
  });
});
