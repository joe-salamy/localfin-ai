const MAX_EXPRESSION_LENGTH = 256;
const MAX_PARENTHESIS_DEPTH = 32;
const MAX_TOKEN_COUNT = 128;

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

function finiteResult(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("calculate expression result must be finite");
  }
  return value;
}

class ExpressionParser {
  private index = 0;
  private tokenCount = 0;
  private parenthesisDepth = 0;

  private readonly expression: string;
  constructor(expression: string) {
    this.expression = expression;
  }

  parse(): number {
    const result = this.parseAdditive();
    this.skipWhitespace();
    if (this.index !== this.expression.length) {
      throw new Error("calculate expression contains an unexpected token");
    }
    return finiteResult(Object.is(result, -0) ? 0 : result);
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();

    while (true) {
      this.skipWhitespace();
      const operator = this.expression[this.index];
      if (operator !== "+" && operator !== "-") return value;

      this.consume(operator);
      const right = this.parseMultiplicative();
      value = this.applyBinary(operator, value, right);
    }
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();

    while (true) {
      this.skipWhitespace();
      const operator = this.expression[this.index];
      if (operator !== "*" && operator !== "/" && operator !== "%") {
        return value;
      }

      this.consume(operator);
      const right = this.parseUnary();
      value = this.applyBinary(operator, value, right);
    }
  }

  private parseUnary(): number {
    this.skipWhitespace();
    const operator = this.expression[this.index];
    if (operator === "+" || operator === "-") {
      this.consume(operator);
      const value = this.parseUnary();
      return finiteResult(operator === "-" ? -value : value);
    }

    return this.parsePower();
  }

  private parsePower(): number {
    let value = this.parsePrimary();
    this.skipWhitespace();

    if (this.expression[this.index] === "^") {
      this.consume("^");
      value = this.applyBinary("^", value, this.parseUnary());
    }

    return value;
  }

  private parsePrimary(): number {
    this.skipWhitespace();

    if (this.expression[this.index] === "(") {
      this.consume("(");
      this.parenthesisDepth += 1;
      if (this.parenthesisDepth > MAX_PARENTHESIS_DEPTH) {
        throw new Error(
          `calculate expression exceeds the ${MAX_PARENTHESIS_DEPTH}-level parenthesis limit`,
        );
      }

      const value = this.parseAdditive();
      this.skipWhitespace();
      if (this.expression[this.index] !== ")") {
        throw new Error("calculate expression is missing a closing parenthesis");
      }
      this.consume(")");
      this.parenthesisDepth -= 1;
      return value;
    }

    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipWhitespace();
    const start = this.index;
    let wholeDigits = 0;
    while (isDigit(this.expression[this.index])) {
      this.index += 1;
      wholeDigits += 1;
    }

    let fractionDigits = 0;
    if (this.expression[this.index] === ".") {
      this.index += 1;
      while (isDigit(this.expression[this.index])) {
        this.index += 1;
        fractionDigits += 1;
      }
    }

    if (wholeDigits === 0 && fractionDigits === 0) {
      throw new Error("calculate expression expected a number or parenthesis");
    }

    if (this.expression[this.index] === "e" || this.expression[this.index] === "E") {
      this.index += 1;
      if (this.expression[this.index] === "+" || this.expression[this.index] === "-") {
        this.index += 1;
      }
      const exponentStart = this.index;
      while (isDigit(this.expression[this.index])) {
        this.index += 1;
      }
      if (this.index === exponentStart) {
        throw new Error("calculate expression has an invalid exponent");
      }
    }

    this.countToken();
    return finiteResult(Number(this.expression.slice(start, this.index)));
  }

  private applyBinary(
    operator: string,
    left: number,
    right: number,
  ): number {
    const result =
      operator === "+"
        ? left + right
        : operator === "-"
          ? left - right
          : operator === "*"
            ? left * right
            : operator === "/"
              ? left / right
              : operator === "%"
                ? left % right
                : left ** right;

    return finiteResult(result);
  }

  private consume(expected: string): void {
    this.skipWhitespace();
    if (this.expression[this.index] !== expected) {
      throw new Error("calculate expression contains an unexpected token");
    }
    this.index += 1;
    this.countToken();
  }

  private countToken(): void {
    this.tokenCount += 1;
    if (this.tokenCount > MAX_TOKEN_COUNT) {
      throw new Error(
        `calculate expression exceeds the ${MAX_TOKEN_COUNT}-token limit`,
      );
    }
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.expression[this.index] ?? "")) {
      this.index += 1;
    }
  }
}

export function calculateExpression(expression: string): number {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(
      `calculate expression exceeds the ${MAX_EXPRESSION_LENGTH}-character limit`,
    );
  }

  const normalized = expression.trim();
  if (!normalized) {
    throw new Error("calculate requires a non-empty expression");
  }

  return new ExpressionParser(normalized).parse();
}
