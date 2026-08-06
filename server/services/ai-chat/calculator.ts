import { Parser } from "expr-eval";

const MAX_EXPRESSION_LENGTH = 256;
const MAX_PARENTHESIS_DEPTH = 32;
const MAX_TOKEN_COUNT = 128;

const parser = new Parser({
  operators: {
    add: true,
    concatenate: false,
    conditional: false,
    divide: true,
    factorial: false,
    multiply: true,
    power: true,
    remainder: true,
    subtract: true,
    logical: false,
    comparison: false,
    in: false,
    assignment: false,
  },
});

function finiteResult(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("calculate expression result must be finite");
  }
  // Avoid presenting -0 to callers/tests.
  return Object.is(value, -0) ? 0 : value;
}

function assertComplexityLimits(expression: string): void {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(
      `calculate expression exceeds character limit of ${MAX_EXPRESSION_LENGTH}`,
    );
  }

  let depth = 0;
  let maxDepth = 0;
  let tokenCount = 0;
  let inNumber = false;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index]!;
    if (char === "(") {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      inNumber = false;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      inNumber = false;
      continue;
    }
    if (/\s/.test(char)) {
      inNumber = false;
      continue;
    }
    if (/[0-9.]/.test(char) || ((char === "e" || char === "E") && inNumber)) {
      if (!inNumber) {
        tokenCount += 1;
        inNumber = true;
      }
      continue;
    }
    if (char === "+" || char === "-") {
      // unary or binary operator token
      tokenCount += 1;
      inNumber = false;
      continue;
    }
    if (
      char === "*" ||
      char === "/" ||
      char === "%" ||
      char === "^" ||
      char === ","
    ) {
      tokenCount += 1;
      inNumber = false;
      continue;
    }
    // letters start identifier tokens (rejected later if present as variables/functions)
    if (/[A-Za-z_]/.test(char)) {
      if (!inNumber) {
        tokenCount += 1;
        inNumber = true;
      }
      continue;
    }
    inNumber = false;
  }

  if (maxDepth > MAX_PARENTHESIS_DEPTH) {
    throw new Error(
      `calculate expression exceeds parenthesis limit of ${MAX_PARENTHESIS_DEPTH}`,
    );
  }
  if (tokenCount > MAX_TOKEN_COUNT) {
    throw new Error(
      `calculate expression exceeds token limit of ${MAX_TOKEN_COUNT}`,
    );
  }
}

export function calculateExpression(expression: string): number {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new Error("calculate expression must not be empty");
  }
  assertComplexityLimits(trimmed);

  let parsed;
  try {
    parsed = parser.parse(trimmed);
  } catch {
    throw new Error("calculate expression is invalid");
  }

  const variables = parsed.variables({ withMembers: true });
  if (variables.length > 0) {
    throw new Error("calculate expression must not use variables or functions");
  }

  const value = parsed.evaluate({});
  if (typeof value !== "number") {
    throw new Error("calculate expression result must be a number");
  }
  return finiteResult(value);
}
