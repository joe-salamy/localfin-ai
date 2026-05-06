export class TransactionSearchSyntaxError extends Error {
  constructor(message: string) {
    super(`Invalid transaction search: ${message}`);
    this.name = "TransactionSearchSyntaxError";
  }
}

type Token =
  | { type: "word"; value: string }
  | { type: "phrase"; value: string }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "or" };

type SearchNode =
  | { type: "term"; value: string }
  | { type: "field"; field: SearchField; operator: SearchOperator; value: string }
  | { type: "and"; nodes: SearchNode[] }
  | { type: "or"; nodes: SearchNode[] }
  | { type: "not"; node: SearchNode };

type SearchField =
  | "name"
  | "comment"
  | "account"
  | "category"
  | "subcategory"
  | "amount"
  | "date"
  | "type";

type SearchOperator = ":" | "=" | ">" | "<" | ">=" | "<=";

interface SearchAliases {
  transaction: string;
  account?: string;
  subcategory?: string;
  category?: string;
}

export interface CompiledTransactionSearch {
  clause: string;
  params: unknown[];
}

const FIELD_ALIASES: Record<string, SearchField> = {
  name: "name",
  merchant: "name",
  description: "name",
  comment: "comment",
  note: "comment",
  account: "account",
  category: "category",
  subcategory: "subcategory",
  amount: "amount",
  date: "date",
  type: "type",
};

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < query.length) {
    const char = query[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "lparen" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen" });
      index += 1;
      continue;
    }
    if (char === "|") {
      tokens.push({ type: "or" });
      index += 1;
      continue;
    }
    if (char === '"') {
      index += 1;
      let value = "";
      let closed = false;
      while (index < query.length) {
        const current = query[index];
        if (current === "\\") {
          const next = query[index + 1];
          if (next === undefined) {
            value += current;
            index += 1;
            continue;
          }
          value += next;
          index += 2;
          continue;
        }
        if (current === '"') {
          closed = true;
          index += 1;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) throw new TransactionSearchSyntaxError("unterminated quote");
      if (!value.trim()) throw new TransactionSearchSyntaxError("empty quoted phrase");
      tokens.push({ type: "phrase", value });
      continue;
    }

    let value = "";
    while (index < query.length && !/[\s()|]/.test(query[index] ?? "")) {
      if (query[index] === '"' && /^[A-Za-z_]+(>=|<=|:|=|>|<)$/.test(value)) {
        break;
      }
      value += query[index];
      index += 1;
    }
    if (value) tokens.push({ type: "word", value });
  }

  return tokens;
}

class Parser {
  private index = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): SearchNode {
    if (this.tokens.length === 0) {
      throw new TransactionSearchSyntaxError("empty query");
    }

    const node = this.parseOr();
    if (!this.atEnd()) {
      throw new TransactionSearchSyntaxError("unexpected token");
    }
    return node;
  }

  private parseOr(): SearchNode {
    const nodes = [this.parseAnd()];
    while (this.matchOr()) {
      nodes.push(this.parseAnd());
    }
    return nodes.length === 1 ? nodes[0] as SearchNode : { type: "or", nodes };
  }

  private parseAnd(): SearchNode {
    const nodes = [this.parseUnary()];

    while (!this.atEnd() && !this.check("rparen") && !this.checkOr()) {
      if (this.matchWordOperator("AND")) {
        if (this.atEnd() || this.check("rparen") || this.checkOr()) {
          throw new TransactionSearchSyntaxError("AND requires a search term");
        }
      }
      nodes.push(this.parseUnary());
    }

    return nodes.length === 1 ? nodes[0] as SearchNode : { type: "and", nodes };
  }

  private parseUnary(): SearchNode {
    if (this.matchWordOperator("NOT")) {
      return { type: "not", node: this.parseUnary() };
    }

    const token = this.peek();
    if (token?.type === "word" && token.value.startsWith("-") && token.value.length > 1) {
      this.index += 1;
      return { type: "not", node: this.wordToNode(token.value.slice(1)) };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): SearchNode {
    const token = this.peek();
    if (!token) throw new TransactionSearchSyntaxError("expected a search term");

    if (token.type === "lparen") {
      this.index += 1;
      const node = this.parseOr();
      if (!this.match("rparen")) {
        throw new TransactionSearchSyntaxError("missing closing parenthesis");
      }
      return node;
    }

    if (token.type === "phrase") {
      this.index += 1;
      return { type: "term", value: token.value };
    }

    if (token.type === "word") {
      this.index += 1;
      return this.wordToNode(token.value);
    }

    throw new TransactionSearchSyntaxError("expected a search term");
  }

  private wordToNode(value: string): SearchNode {
    const inlineMatch = /^([A-Za-z_]+)(>=|<=|:|=|>|<)(.*)$/.exec(value);
    if (!inlineMatch) return { type: "term", value };

    const [, rawField, operator, inlineValue] = inlineMatch;
    const field = parseField(rawField ?? "");
    const parsedOperator = operator as SearchOperator;

    if (inlineValue) {
      return { type: "field", field, operator: parsedOperator, value: inlineValue };
    }

    const next = this.peek();
    if (!next || (next.type !== "word" && next.type !== "phrase")) {
      throw new TransactionSearchSyntaxError(`${field} search requires a value`);
    }
    this.index += 1;
    return { type: "field", field, operator: parsedOperator, value: next.value };
  }

  private match(type: Token["type"]): boolean {
    if (!this.check(type)) return false;
    this.index += 1;
    return true;
  }

  private matchOr(): boolean {
    if (this.match("or")) return true;
    return this.matchWordOperator("OR");
  }

  private matchWordOperator(operator: "AND" | "OR" | "NOT"): boolean {
    const token = this.peek();
    if (token?.type !== "word" || token.value.toUpperCase() !== operator) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private check(type: Token["type"]): boolean {
    return this.peek()?.type === type;
  }

  private checkOr(): boolean {
    const token = this.peek();
    return token?.type === "or" || (token?.type === "word" && token.value.toUpperCase() === "OR");
  }

  private atEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }
}

function parseField(rawField: string): SearchField {
  const field = FIELD_ALIASES[rawField.toLowerCase()];
  if (!field) {
    throw new TransactionSearchSyntaxError(`unknown field "${rawField}"`);
  }
  return field;
}

function likePattern(value: string): string {
  return `%${value.toLowerCase()}%`;
}

function textLike(column: string): string {
  return `LOWER(COALESCE(${column}, '')) LIKE ?`;
}

function transactionColumn(aliases: SearchAliases, column: string): string {
  return `${aliases.transaction}.${column}`;
}

function optionalAlias(aliases: SearchAliases, key: "account" | "subcategory" | "category"): string {
  const alias = aliases[key];
  if (!alias) {
    throw new TransactionSearchSyntaxError(`${key} field search requires detail joins`);
  }
  return alias;
}

function compileTextField(column: string, operator: SearchOperator, value: string): CompiledTransactionSearch {
  const normalizedValue = value.toLowerCase();
  if (operator === ":" || operator === "=") {
    return { clause: textLike(column), params: [likePattern(value)] };
  }
  return {
    clause: `LOWER(COALESCE(${column}, '')) ${operator} ?`,
    params: [normalizedValue],
  };
}

function compileNumericField(column: string, operator: SearchOperator, value: string): CompiledTransactionSearch {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new TransactionSearchSyntaxError(`amount search requires a number`);
  }
  const sqlOperator = operator === ":" ? "=" : operator;
  return { clause: `${column} ${sqlOperator} ?`, params: [numericValue] };
}

function compileDateField(column: string, operator: SearchOperator, value: string): CompiledTransactionSearch {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TransactionSearchSyntaxError(`date search requires YYYY-MM-DD`);
  }
  const sqlOperator = operator === ":" ? "=" : operator;
  return { clause: `${column} ${sqlOperator} ?`, params: [value] };
}

function compileTypeField(
  categoryTypeColumn: string,
  amountColumn: string,
  operator: SearchOperator,
  value: string,
): CompiledTransactionSearch {
  const compiledText = compileTextField(categoryTypeColumn, operator, value);
  const normalizedValue = value.toLowerCase();
  if (operator !== ":" && operator !== "=") return compiledText;
  if (normalizedValue === "income") {
    return { clause: `(${compiledText.clause} OR ${amountColumn} > 0)`, params: compiledText.params };
  }
  if (normalizedValue === "expense") {
    return { clause: `(${compiledText.clause} OR ${amountColumn} < 0)`, params: compiledText.params };
  }
  return compiledText;
}

function compileFieldNode(
  node: Extract<SearchNode, { type: "field" }>,
  aliases: SearchAliases,
): CompiledTransactionSearch {
  switch (node.field) {
    case "name":
      return compileTextField(transactionColumn(aliases, "name"), node.operator, node.value);
    case "comment":
      return compileTextField(transactionColumn(aliases, "comment"), node.operator, node.value);
    case "account":
      return compileTextField(`${optionalAlias(aliases, "account")}.name`, node.operator, node.value);
    case "category":
      return compileTextField(`${optionalAlias(aliases, "category")}.name`, node.operator, node.value);
    case "subcategory":
      return compileTextField(`${optionalAlias(aliases, "subcategory")}.name`, node.operator, node.value);
    case "amount":
      return compileNumericField(transactionColumn(aliases, "amount"), node.operator, node.value);
    case "date":
      return compileDateField(transactionColumn(aliases, "date"), node.operator, node.value);
    case "type":
      return compileTypeField(
        `${optionalAlias(aliases, "category")}.type`,
        transactionColumn(aliases, "amount"),
        node.operator,
        node.value,
      );
  }
}

function compileNode(node: SearchNode, aliases: SearchAliases): CompiledTransactionSearch {
  switch (node.type) {
    case "term": {
      const columns = [
        transactionColumn(aliases, "name"),
        transactionColumn(aliases, "comment"),
        transactionColumn(aliases, "date"),
        `CAST(${transactionColumn(aliases, "amount")} AS TEXT)`,
      ];
      if (aliases.account) columns.push(`${aliases.account}.name`);
      if (aliases.subcategory) columns.push(`${aliases.subcategory}.name`);
      if (aliases.category) {
        columns.push(`${aliases.category}.name`, `${aliases.category}.type`);
      }
      return {
        clause: `(${columns.map(textLike).join(" OR ")})`,
        params: columns.map(() => likePattern(node.value)),
      };
    }
    case "field":
      return compileFieldNode(node, aliases);
    case "not": {
      const compiled = compileNode(node.node, aliases);
      return { clause: `NOT (${compiled.clause})`, params: compiled.params };
    }
    case "and":
    case "or": {
      const compiledNodes = node.nodes.map((child) => compileNode(child, aliases));
      const joiner = node.type === "and" ? " AND " : " OR ";
      return {
        clause: `(${compiledNodes.map((compiled) => compiled.clause).join(joiner)})`,
        params: compiledNodes.flatMap((compiled) => compiled.params),
      };
    }
  }
}

export function compileTransactionSearch(
  query: string,
  aliases: SearchAliases,
): CompiledTransactionSearch {
  const trimmed = query.trim();
  const ast = new Parser(tokenize(trimmed)).parse();
  return compileNode(ast, aliases);
}
