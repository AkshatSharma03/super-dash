type Token =
  | { type: "number"; value: number }
  | { type: "variable"; name: string }
  | { type: "operator"; op: "+" | "-" | "*" | "/" }
  | { type: "lparen" }
  | { type: "rparen" };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i]; i++; }
      tokens.push({ type: "number", value: parseFloat(num) });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let name = "";
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) { name += expr[i]; i++; }
      tokens.push({ type: "variable", name: name.toLowerCase() });
      continue;
    }
    if (ch === "+") { tokens.push({ type: "operator", op: "+" }); i++; continue; }
    if (ch === "-") { tokens.push({ type: "operator", op: "-" }); i++; continue; }
    if (ch === "*") { tokens.push({ type: "operator", op: "*" }); i++; continue; }
    if (ch === "/") { tokens.push({ type: "operator", op: "/" }); i++; continue; }
    if (ch === "(") { tokens.push({ type: "lparen" }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "rparen" }); i++; continue; }
    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }
  return tokens;
}

function precedence(op: "+" | "-" | "*" | "/"): number {
  return op === "*" || op === "/" ? 2 : 1;
}

function applyOp(op: "+" | "-" | "*" | "/", b: number, a: number): number {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/":
      if (b === 0) throw new Error("Division by zero");
      return a / b;
  }
}

export interface ExprError {
  message: string;
  position?: number;
}

export function validateExpression(expr: string): { valid: boolean; error?: ExprError; variables?: string[] } {
  try {
    const tokens = tokenize(expr);
    const variables = new Set<string>();
    for (const t of tokens) {
      if (t.type === "variable") variables.add(t.name);
    }
    if (tokens.length === 0) return { valid: false, error: { message: "Expression is empty" } };

    let parenCount = 0;
    for (const t of tokens) {
      if (t.type === "lparen") parenCount++;
      if (t.type === "rparen") parenCount--;
      if (parenCount < 0) return { valid: false, error: { message: "Mismatched parentheses" } };
    }
    if (parenCount !== 0) return { valid: false, error: { message: "Mismatched parentheses" } };

    return { valid: true, variables: [...variables] };
  } catch (e) {
    return { valid: false, error: { message: e instanceof Error ? e.message : "Invalid expression" } };
  }
}

export const KNOWN_VARIABLES: Record<string, { label: string; unit: string; description: string }> = {
  gdp: { label: "GDP", unit: "$B", description: "Nominal GDP in billions USD" },
  gdp_growth: { label: "GDP Growth", unit: "%", description: "Real GDP growth rate" },
  gdp_per_capita: { label: "GDP per Capita", unit: "$", description: "GDP per capita in USD" },
  exports: { label: "Total Exports", unit: "$B", description: "Total exports in billions USD" },
  imports: { label: "Total Imports", unit: "$B", description: "Total imports in billions USD" },
  trade_balance: { label: "Trade Balance", unit: "$B", description: "Exports minus imports" },
  trade_openness: { label: "Trade Openness", unit: "%", description: "(Exports + Imports) / GDP × 100" },
  population: { label: "Population", unit: "M", description: "Population in millions" },
};

export interface EvaluatedMetric {
  name: string;
  expression: string;
  values: Array<{ year: number; value: number | null }>;
  unit: string;
}

export function evaluateMetric(
  expression: string,
  data: {
    gdpData: Array<{ year: number; gdp_bn: number | null; gdp_growth: number | null; gdp_per_capita: number | null }>;
    exportData: Array<{ year: number; total: number }>;
    importData: Array<{ year: number; total: number }>;
  },
): EvaluatedMetric {
  const { variables } = validateExpression(expression);
  if (!variables) throw new Error("Invalid expression");

  const expMap = new Map(data.exportData.map(d => [d.year, d.total]));
  const impMap = new Map(data.importData.map(d => [d.year, d.total]));

  const allYears = [...new Set([
    ...data.gdpData.map(d => d.year),
    ...data.exportData.map(d => d.year),
    ...data.importData.map(d => d.year),
  ])].sort((a, b) => a - b);

  const values = allYears.map(year => {
    const gdpRow = data.gdpData.find(d => d.year === year);
    const expTotal = expMap.get(year);
    const impTotal = impMap.get(year);

    const context: Record<string, number | null> = {
      gdp: gdpRow?.gdp_bn ?? null,
      gdp_growth: gdpRow?.gdp_growth ?? null,
      gdp_per_capita: gdpRow?.gdp_per_capita ?? null,
      exports: expTotal ?? null,
      imports: impTotal ?? null,
      trade_balance: (expTotal != null && impTotal != null) ? +(expTotal - impTotal).toFixed(2) : null,
      trade_openness: (expTotal != null && impTotal != null && gdpRow?.gdp_bn != null && gdpRow.gdp_bn !== 0)
        ? +(((expTotal + impTotal) / gdpRow.gdp_bn) * 100).toFixed(2)
        : null,
    };

    const hasNull = variables.some(v => context[v] == null);
    if (hasNull) return { year, value: null };

    const evalContext: Record<string, number> = {};
    for (const v of variables) {
      const val = context[v];
      if (val != null) evalContext[v] = val;
    }

    try {
      const tokens = tokenize(expression);
      const outputQueue: Token[] = [];
      const opStack: Token[] = [];

      for (const token of tokens) {
        if (token.type === "number" || token.type === "variable") {
          outputQueue.push(token);
        } else if (token.type === "operator") {
          while (opStack.length > 0) {
            const top = opStack[opStack.length - 1];
            if (top.type === "operator" && precedence(top.op) >= precedence(token.op)) {
              outputQueue.push(opStack.pop()!);
            } else {
              break;
            }
          }
          opStack.push(token);
        } else if (token.type === "lparen") {
          opStack.push(token);
        } else if (token.type === "rparen") {
          while (opStack.length > 0 && opStack[opStack.length - 1].type !== "lparen") {
            outputQueue.push(opStack.pop()!);
          }
          opStack.pop();
        }
      }
      while (opStack.length > 0) outputQueue.push(opStack.pop()!);

      const evalStack: number[] = [];
      for (const token of outputQueue) {
        if (token.type === "number") {
          evalStack.push(token.value);
        } else if (token.type === "variable") {
          const val = evalContext[token.name];
          if (val == null) return { year, value: null };
          evalStack.push(val);
        } else if (token.type === "operator") {
          const b = evalStack.pop()!;
          const a = evalStack.pop()!;
          evalStack.push(applyOp(token.op, b, a));
        }
      }

      return { year, value: +evalStack[0].toFixed(2) };
    } catch {
      return { year, value: null };
    }
  });

  return {
    name: expression,
    expression,
    values,
    unit: "custom",
  };
}