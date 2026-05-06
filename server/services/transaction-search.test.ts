import assert from "node:assert/strict";
import test from "node:test";
import {
  TransactionSearchSyntaxError,
  compileTransactionSearch,
} from "./transaction-search.js";

const aliases = {
  transaction: "t",
  account: "a",
  subcategory: "s",
  category: "c",
};

test("bare terms search joined transaction detail text", () => {
  const compiled = compileTransactionSearch("coffee", aliases);

  assert.match(compiled.clause, /t\.name/);
  assert.match(compiled.clause, /a\.name/);
  assert.match(compiled.clause, /s\.name/);
  assert.match(compiled.clause, /c\.name/);
  assert.ok(compiled.params.every((param) => param === "%coffee%"));
});

test("quoted phrases and logical operators compile with precedence", () => {
  const compiled = compileTransactionSearch('"whole foods" OR coffee AND NOT starbucks', aliases);

  assert.match(compiled.clause, / OR /);
  assert.match(compiled.clause, / AND /);
  assert.match(compiled.clause, /NOT/);
  assert.ok(compiled.params.includes("%whole foods%"));
  assert.ok(compiled.params.includes("%coffee%"));
  assert.ok(compiled.params.includes("%starbucks%"));
});

test("grep-style shortcuts compile", () => {
  const compiled = compileTransactionSearch("(uber | lyft) -eats", aliases);

  assert.match(compiled.clause, / OR /);
  assert.match(compiled.clause, /NOT/);
  assert.ok(compiled.params.includes("%uber%"));
  assert.ok(compiled.params.includes("%lyft%"));
  assert.ok(compiled.params.includes("%eats%"));
});

test("field qualifiers and comparisons use parameterized predicates", () => {
  const compiled = compileTransactionSearch(
    "account:checking category:food amount>20 date<=2026-05-01",
    aliases,
  );

  assert.match(compiled.clause, /a\.name/);
  assert.match(compiled.clause, /c\.name/);
  assert.match(compiled.clause, /t\.amount > \?/);
  assert.match(compiled.clause, /t\.date <= \?/);
  assert.deepEqual(compiled.params, [
    "%checking%",
    "%food%",
    20,
    "2026-05-01",
  ]);
});

test("field value can be a quoted phrase after a colon", () => {
  const compiled = compileTransactionSearch('comment:"trip refund"', aliases);

  assert.match(compiled.clause, /t\.comment/);
  assert.deepEqual(compiled.params, ["%trip refund%"]);
});

test("unsafe-looking input remains a LIKE parameter", () => {
  const compiled = compileTransactionSearch('name:"x%' + "' OR 1=1 --" + '"', aliases);

  assert.equal(compiled.params.length, 1);
  assert.equal(compiled.params[0], "%x%' or 1=1 --%");
  assert.doesNotMatch(compiled.clause, /1=1/);
});


test("type field falls back to amount sign", () => {
  const income = compileTransactionSearch("type:income", aliases);
  const expense = compileTransactionSearch("type:expense", aliases);

  assert.match(income.clause, /c\.type/);
  assert.match(income.clause, /t\.amount > 0/);
  assert.match(expense.clause, /t\.amount < 0/);
});
test("invalid syntax reports a search syntax error", () => {
  assert.throws(
    () => compileTransactionSearch('"unterminated', aliases),
    TransactionSearchSyntaxError,
  );
  assert.throws(
    () => compileTransactionSearch("unknown:value", aliases),
    TransactionSearchSyntaxError,
  );
  assert.throws(
    () => compileTransactionSearch("amount>coffee", aliases),
    TransactionSearchSyntaxError,
  );
});
