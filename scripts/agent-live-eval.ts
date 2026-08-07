import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import type Database from "better-sqlite3";
import type {
  ChatActionResult,
  ChatRequest,
  ChatResult,
  ChatStreamEvent,
} from "../shared/contracts/index.js";
import {
  assertAccount,
  assertActionCount,
  assertAllActionsSucceeded,
  assertAnyActionFailed,
  assertCategory,
  assertGoal,
  assertMatchingTransactionsSubcategory,
  assertNoAction,
  assertNoDeletedRows,
  assertSearchBeforeUpdate,
  assertStreamLifecycle,
  assertSubcategory,
  assertTransaction,
  type AgentEvalAssertion as EvalAssertion,
  type AgentEvalContext as EvalContext,
  type AgentEvalSeed as ScenarioSeed,
  type AgentEvalServices,
  readAgentSnapshot,
  seedAgentScenario,
} from "../server/testing/agent-eval.js";
type EvalAction = ChatActionResult;
type AssertionResult = {
  name: string;
  status: "pass" | "fail";
  details?: string;
};

interface LiveAgentScenario {
  suite: string;
  name: string;
  prompt: string;
  mode?: "chat" | "stream";
  maxAssistantTurns?: number;
  seed?: ScenarioSeed;
  assertions: EvalAssertion[];
}

interface EvalCaseReport {
  suite: string;
  name: string;
  prompt: string;
  status: "pass" | "fail" | "infrastructure_failure";
  durationMs: number;
  actionTypes: string[];
  failedAssertions: AssertionResult[];
  assertions: { name: string; status: "pass" | "fail"; details?: string }[];
  message?: string;
  logFile?: string;
  error?: string;
  dbPath: string;
  streamEventTypes?: string[];
}

interface EvalSuiteSummary {
  suite: string;
  total: number;
  passed: number;
  failed: number;
  infrastructureFailures: number;
}

interface EvalReport {
  generatedAt: string;
  model: string;
  total: number;
  passed: number;
  failed: number;
  infrastructureFailures: number;
  suites: EvalSuiteSummary[];
  cases: EvalCaseReport[];
}

interface ServiceModules extends AgentEvalServices {
  chatWithAssistant: (request: ChatRequest) => Promise<ChatResult>;
  streamChatWithAssistant: (
    request: ChatRequest,
    emit: (event: ChatStreamEvent) => void | Promise<void>,
  ) => Promise<ChatResult>;
  getDb: () => Database.Database;
  closeDbForTests: () => void;
}
const REPORT_ROOT = path.resolve(process.cwd(), ".agent-harness", "reports");


dotenv.config();

function onboardingAssertions(): EvalAssertion[] {
  return [
    assertActionCount("create_account", 3),
    assertActionCount("create_category", 2),
    assertActionCount("create_subcategory", 4),
    assertActionCount("create_goal", 2),
    assertAccount("Test Checking", "asset"),
    assertAccount("Test Savings", "asset"),
    assertAccount("Test Credit Card", "liability"),
    assertCategory("Food", "expense"),
    assertCategory("Income", "income"),
    assertSubcategory("Groceries", "Food", 650),
    assertSubcategory("Restaurants", "Food", 300),
    assertSubcategory("Paycheck", "Income"),
    assertGoal("Groceries", 650, "monthly"),
    assertAllActionsSucceeded(),
  ];
}

const baseSeed: ScenarioSeed = {
  accounts: [
    { name: "Test Checking", type: "asset", initial_balance: 1200 },
    { name: "Test Savings", type: "asset", initial_balance: 5000 },
    { name: "Test Credit Card", type: "liability", initial_balance: -250 },
  ],
  categories: [
    {
      name: "Food",
      type: "expense",
      subcategories: [
        { name: "Groceries", monthly_goal: 650 },
        { name: "Restaurants", monthly_goal: 300 },
      ],
    },
    {
      name: "Transportation",
      type: "expense",
      subcategories: [
        { name: "Rideshare", monthly_goal: 120 },
        { name: "Fuel", monthly_goal: 180 },
      ],
    },
    {
      name: "Travel",
      type: "expense",
      subcategories: [
        { name: "Hotels", monthly_goal: 0 },
        { name: "Flights", monthly_goal: 0 },
      ],
    },
    {
      name: "Income",
      type: "income",
      subcategories: [{ name: "Paycheck" }, { name: "Reimbursements" }],
    },
    {
      name: "Bills",
      type: "expense",
      subcategories: [
        { name: "Utilities", monthly_goal: 220 },
        { name: "Subscriptions", monthly_goal: 80 },
        { name: "Rent", monthly_goal: 1600 },
        { name: "Bank Fees", monthly_goal: 20 },
      ],
    },
  ],
  transactions: [
    {
      account: "Test Checking",
      date: "2026-04-03",
      name: "Whole Foods Market",
      amount: -84.32,
      subcategory: "Groceries",
      comment: "weekly groceries",
    },
    {
      account: "Test Credit Card",
      date: "2026-04-04",
      name: "Uber Trip Downtown",
      amount: -18.45,
      subcategory: "Rideshare",
      comment: "client meeting",
    },
    {
      account: "Test Credit Card",
      date: "2026-04-06",
      name: "Uber Eats Thai",
      amount: -32.1,
      subcategory: "Restaurants",
      comment: "late dinner",
    },
    {
      account: "Test Credit Card",
      date: "2026-04-10",
      name: "Lyft Airport",
      amount: -42.75,
      subcategory: "Rideshare",
      comment: "work trip",
    },
    {
      account: "Test Credit Card",
      date: "2026-04-11",
      name: "Marriott Hotel",
      amount: -215.4,
      subcategory: "Hotels",
      comment: "work trip not reimbursed yet",
    },
    {
      account: "Test Checking",
      date: "2026-04-15",
      name: "Acme Payroll",
      amount: 2750,
      subcategory: "Paycheck",
      comment: "salary",
    },
    {
      account: "Test Checking",
      date: "2026-04-01",
      name: "ZELLE INSTANT PMT TO Nick",
      amount: -1561,
      subcategory: "Rideshare",
    },
    {
      account: "Test Checking",
      date: "2026-05-01",
      name: "ZELLE INSTANT PMT TO Nick",
      amount: -1561,
      subcategory: "Rideshare",
    },
    {
      account: "Test Checking",
      date: "2026-04-30",
      name: "MONTHLY MAINTENANCE FEE",
      amount: -12,
      subcategory: "Utilities",
    },
    {
      account: "Test Checking",
      date: "2026-05-05",
      name: "MONTHLY MAINTENANCE FEE",
      amount: -12,
      subcategory: "Utilities",
    },
  ],
  goals: [
    {
      subcategory: "Groceries",
      amount: 650,
      period: "monthly",
      start_date: "2026-04-01",
    },
    {
      subcategory: "Restaurants",
      amount: 300,
      period: "monthly",
      start_date: "2026-04-01",
    },
    {
      subcategory: "Rideshare",
      amount: 120,
      period: "monthly",
      start_date: "2026-04-01",
    },
  ],
};

const scenarios: LiveAgentScenario[] = [
  {
    suite: "onboarding",
    name: "create full starter budget",
    prompt:
      "Set up my test budget. Create asset accounts Test Checking with 1200, Test Savings with 5000, and liability account Test Credit Card with -250. Add expense categories Food and Transportation, income category Income, subcategories Groceries goal 650, Restaurants goal 300, Rideshare goal 120, Fuel goal 180, and Paycheck. Create monthly goals starting 2026-04-01 for Groceries and Restaurants.",
    assertions: onboardingAssertions(),
  },
  {
    suite: "onboarding",
    name: "create travel and bills structure",
    prompt:
      "For this eval account, add expense categories Travel and Bills. Under Travel add Hotels and Flights. Under Bills add Utilities with a 220 monthly target and Subscriptions with an 80 monthly target. Make goals for Utilities and Subscriptions starting 2026-04-01.",
    assertions: [
      assertCategory("Travel", "expense"),
      assertCategory("Bills", "expense"),
      assertSubcategory("Hotels", "Travel"),
      assertSubcategory("Flights", "Travel"),
      assertSubcategory("Utilities", "Bills", 220),
      assertSubcategory("Subscriptions", "Bills", 80),
      assertGoal("Utilities", 220, "monthly"),
      assertGoal("Subscriptions", 80, "monthly"),
      assertAllActionsSucceeded(),
    ],
  },
  {
    suite: "messy transaction entry",
    name: "mixed spending and reimbursement",
    seed: baseSeed,
    prompt:
      "Add these to Test Credit Card: May 1 Whole Foods 76.44 groceries, May 2 Uber ride 21.90 rideshare for airport, May 3 Delta flight 318.20 flights for work trip. Also add a +318.20 reimbursement on Test Checking dated May 7 in Reimbursements with comment Delta flight refund.",
    assertions: [
      assertActionCount("create_transaction", 4),
      assertTransaction({
        account: "Test Credit Card",
        date: "2026-05-01",
        nameIncludes: "Whole Foods",
        amount: -76.44,
        subcategory: "Groceries",
      }),
      assertTransaction({
        account: "Test Credit Card",
        date: "2026-05-02",
        nameIncludes: "Uber",
        amount: -21.9,
        subcategory: "Rideshare",
        commentIncludes: "airport",
      }),
      assertTransaction({
        account: "Test Credit Card",
        date: "2026-05-03",
        nameIncludes: "Delta",
        amount: -318.2,
        subcategory: "Flights",
      }),
      assertTransaction({
        account: "Test Checking",
        date: "2026-05-07",
        nameIncludes: "reimbursement",
        amount: 318.2,
        subcategory: "Reimbursements",
        commentIncludes: "Delta",
      }),
      assertAllActionsSucceeded(),
    ],
  },
  {
    suite: "messy transaction entry",
    name: "same merchant corrections",
    seed: baseSeed,
    prompt:
      "Record two Target trips on Test Checking: 2026-05-04 Target groceries 48.13 and 2026-05-05 Target household snacks 19.26 restaurants. Add comments that the first was weekly groceries and the second was lunch supplies.",
    assertions: [
      assertActionCount("create_transaction", 2),
      assertTransaction({
        account: "Test Checking",
        date: "2026-05-04",
        nameIncludes: "Target",
        amount: -48.13,
        subcategory: "Groceries",
        commentIncludes: "weekly",
      }),
      assertTransaction({
        account: "Test Checking",
        date: "2026-05-05",
        nameIncludes: "Target",
        amount: -19.26,
        subcategory: "Restaurants",
        commentIncludes: "lunch",
      }),
      assertAllActionsSucceeded(),
    ],
  },
  {
    suite: "messy transaction entry",
    name: "income and card payment",
    seed: baseSeed,
    prompt:
      "Add my 2026-05-15 Acme Payroll deposit of 2750 to Test Checking as Paycheck. Also add a Test Checking card payment of -400 with comment payment to Test Credit Card, and a matching +400 on Test Credit Card with comment payment from checking, both dated 2026-05-16.",
    assertions: [
      assertActionCount("create_transaction", 3),
      assertTransaction({
        account: "Test Checking",
        date: "2026-05-15",
        nameIncludes: "Acme",
        amount: 2750,
        subcategory: "Paycheck",
      }),
      assertTransaction({
        account: "Test Checking",
        date: "2026-05-16",
        nameIncludes: "payment",
        amount: -400,
        commentIncludes: "Credit Card",
      }),
      assertTransaction({
        account: "Test Credit Card",
        date: "2026-05-16",
        nameIncludes: "payment",
        amount: 400,
        commentIncludes: "checking",
      }),
      assertAllActionsSucceeded(),
    ],
  },
  {
    suite: "search and update",
    name: "rideshare not eats",
    seed: baseSeed,
    prompt:
      "Find the rideshare transaction matching (uber OR lyft) AND amount<0 AND date>=2026-04-01 AND NOT eats. Update the matching airport/work-trip ride to comment 'airport transfer - reimbursable' and keep it in Rideshare.",
    assertions: [
      assertSearchBeforeUpdate(),
      assertTransaction({
        account: "Test Credit Card",
        date: "2026-04-10",
        nameIncludes: "Lyft",
        amount: -42.75,
        subcategory: "Rideshare",
        commentIncludes: "reimbursable",
      }),
    ],
  },
  {
    suite: "search and update",
    name: "hotel reimbursement classification",
    seed: baseSeed,
    prompt:
      'Search comment:"work trip" OR name:"hotel" -reimbursed, then update the hotel transaction so its comment says \'work trip reimbursable\' and the subcategory is Hotels.',
    assertions: [
      assertSearchBeforeUpdate(),
      assertTransaction({
        account: "Test Credit Card",
        date: "2026-04-11",
        nameIncludes: "Marriott",
        amount: -215.4,
        subcategory: "Hotels",
        commentIncludes: "reimbursable",
      }),
    ],
  },
  {
    suite: "search and update",
    name: "grocery amount filter",
    seed: baseSeed,
    prompt:
      "Use account:\"Test Checking\" category:Food subcategory:Groceries amount<-40 to find the April Whole Foods transaction. Update its comment to 'bulk grocery run'.",
    assertions: [
      assertSearchBeforeUpdate(),
      assertTransaction({
        account: "Test Checking",
        date: "2026-04-03",
        nameIncludes: "Whole Foods",
        amount: -84.32,
        subcategory: "Groceries",
        commentIncludes: "bulk",
      }),
    ],
  },
  {
    suite: "search and update",
    name: "bulk matching subcategory update",
    seed: baseSeed,
    prompt:
      'Within Test Checking, change all transactions with "ZELLE INSTANT PMT" to subcategory Rent, and all with "MONTHLY MAINTENANCE FEE" to subcategory Bank Fees.',
    assertions: [
      assertActionCount("bulk_update_transactions", 2),
      assertMatchingTransactionsSubcategory({
        account: "Test Checking",
        nameIncludes: "ZELLE INSTANT PMT",
        subcategory: "Rent",
        count: 2,
      }),
      assertMatchingTransactionsSubcategory({
        account: "Test Checking",
        nameIncludes: "MONTHLY MAINTENANCE FEE",
        subcategory: "Bank Fees",
        count: 2,
      }),
      assertAllActionsSucceeded(),
    ],
  },
  {
    suite: "search and update",
    name: "exclude payroll",
    seed: baseSeed,
    prompt:
      'Find positive transactions in Test Checking that are not payroll using account:"Test Checking" amount>0 NOT payroll. If none match, do not create or update anything; just explain that no matching non-payroll income exists.',
    assertions: [
      assertActionCount("search_transactions", 1),
      assertNoAction("create_transaction"),
      assertNoAction("update_transaction"),
      assertNoDeletedRows(),
    ],
  },
  {
    suite: "multi-intent maintenance",
    name: "rename account and add spending",
    seed: baseSeed,
    prompt:
      "Rename Test Checking to Household Checking. Increase the Groceries monthly goal to 700. Add a 2026-05-20 Costco grocery run for 145.27 on Household Checking with comment bulk pantry restock.",
    assertions: [
      assertActionCount("update_account", 1),
      assertActionCount("update_goal", 1),
      assertAccount("Household Checking", "asset"),
      assertGoal("Groceries", 700, "monthly"),
      assertTransaction({
        account: "Household Checking",
        date: "2026-05-20",
        nameIncludes: "Costco",
        amount: -145.27,
        subcategory: "Groceries",
        commentIncludes: "pantry",
      }),
    ],
  },
  {
    suite: "multi-intent maintenance",
    name: "move subcategory and add bill",
    seed: baseSeed,
    prompt:
      "Create a Household expense category if needed, move Utilities under Household, set Utilities monthly goal to 250, and add a 2026-05-06 City Electric bill for 121.88 on Test Checking in Utilities.",
    assertions: [
      assertCategory("Household", "expense"),
      assertSubcategory("Utilities", "Household", 250),
      assertTransaction({
        account: "Test Checking",
        date: "2026-05-06",
        nameIncludes: "Electric",
        amount: -121.88,
        subcategory: "Utilities",
      }),
    ],
  },
  {
    suite: "multi-intent maintenance",
    name: "quarterly travel goal and flight",
    seed: baseSeed,
    prompt:
      "Set Flights to a quarterly goal of 900 starting 2026-04-01, then add a 2026-05-12 United flight for 287.64 to Test Credit Card in Flights with comment family visit.",
    assertions: [
      assertGoal("Flights", 900, "quarterly"),
      assertTransaction({
        account: "Test Credit Card",
        date: "2026-05-12",
        nameIncludes: "United",
        amount: -287.64,
        subcategory: "Flights",
        commentIncludes: "family",
      }),
    ],
  },
  {
    suite: "robustness and refusal",
    name: "refuse deletion",
    seed: baseSeed,
    prompt:
      "Delete the Marriott Hotel transaction and remove the Travel category. If chat cannot delete, do not modify data and tell me deletion is unavailable.",
    assertions: [
      assertNoAction("delete_transaction"),
      assertNoAction("delete_category"),
      assertNoDeletedRows(),
      assertTransaction({
        account: "Test Credit Card",
        date: "2026-04-11",
        nameIncludes: "Marriott",
        amount: -215.4,
        subcategory: "Hotels",
      }),
    ],
  },
  {
    suite: "robustness and refusal",
    name: "unknown account fails visibly",
    seed: baseSeed,
    prompt:
      "Add a 2026-05-09 Mystery Shop charge for 22.22 to account Vacation Wallet in Groceries. If that account does not exist, report that it could not be added.",
    assertions: [assertAnyActionFailed(), assertNoDeletedRows()],
  },
  {
    suite: "robustness and refusal",
    name: "invalid date rejected",
    seed: baseSeed,
    prompt:
      "Add a Test Checking transaction dated 2026-02-31 named Bad Date Cafe for 18.00 in Restaurants. Use that exact date if possible.",
    assertions: [assertAnyActionFailed(), assertNoDeletedRows()],
  },
  {
    suite: "robustness and refusal",
    name: "duplicate global name fails",
    seed: baseSeed,
    prompt:
      "Create a new expense category named Test Checking. If that conflicts with an account name, report the problem and do not rename anything.",
    assertions: [
      assertAnyActionFailed(),
      assertAccount("Test Checking", "asset"),
      assertNoDeletedRows(),
    ],
  },
  {
    suite: "streaming",
    name: "stream transaction creation",
    mode: "stream",
    seed: baseSeed,
    prompt:
      "Add a 2026-05-22 Trader Joe's grocery purchase for 63.19 on Test Checking in Groceries with comment weekly shop.",
    assertions: [
      assertStreamLifecycle(),
      assertActionCount("create_transaction", 1),
      assertTransaction({
        account: "Test Checking",
        date: "2026-05-22",
        nameIncludes: "Trader",
        amount: -63.19,
        subcategory: "Groceries",
        commentIncludes: "weekly",
      }),
    ],
  },
  {
    suite: "streaming",
    name: "stream search update",
    mode: "stream",
    maxAssistantTurns: 5,
    seed: baseSeed,
    prompt:
      'Search name:"Uber Trip" AND comment:"client" and update that transaction\'s comment to \'client meeting rideshare - reimbursable\'.',
    assertions: [
      assertStreamLifecycle(),
      assertSearchBeforeUpdate(),
      assertTransaction({
        account: "Test Credit Card",
        date: "2026-04-04",
        nameIncludes: "Uber Trip",
        amount: -18.45,
        subcategory: "Rideshare",
        commentIncludes: "reimbursable",
      }),
    ],
  },
  {
    suite: "complex filters",
    name: "or expression restaurant search",
    seed: baseSeed,
    prompt:
      "Find category:Food AND (restaurant OR eats OR thai) and tell me what matched. Do not create or update anything.",
    assertions: [
      assertActionCount("search_transactions", 1),
      assertNoAction("create_transaction"),
      assertNoAction("update_transaction"),
    ],
  },
  {
    suite: "complex filters",
    name: "date range search",
    seed: baseSeed,
    prompt:
      "Search all Test Credit Card expenses from 2026-04-01 through 2026-04-10 with amount<0 and category:Transportation. Do not change any records.",
    assertions: [
      assertActionCount("search_transactions", 1),
      assertNoAction("create_transaction"),
      assertNoAction("update_transaction"),
      assertNoDeletedRows(),
    ],
  },
  {
    suite: "complex filters",
    name: "income search",
    seed: baseSeed,
    prompt:
      'Search for type:income account:"Test Checking" amount>1000 and summarize the matching paycheck. Do not update anything.',
    assertions: [
      assertActionCount("search_transactions", 1),
      assertNoAction("update_transaction"),
      assertTransaction({
        account: "Test Checking",
        date: "2026-04-15",
        nameIncludes: "Acme",
        amount: 2750,
        subcategory: "Paycheck",
      }),
    ],
  },
  {
    suite: "goal updates",
    name: "annual subscription goal",
    seed: baseSeed,
    prompt:
      "Create an annual goal of 960 for Subscriptions starting 2026-01-01, and add a 2026-05-01 Netflix subscription charge of 15.49 on Test Credit Card.",
    assertions: [
      assertGoal("Subscriptions", 960, "annual"),
      assertTransaction({
        account: "Test Credit Card",
        date: "2026-05-01",
        nameIncludes: "Netflix",
        amount: -15.49,
        subcategory: "Subscriptions",
      }),
    ],
  },
  {
    suite: "goal updates",
    name: "weekly restaurant goal",
    seed: baseSeed,
    prompt:
      "Change Restaurants to a weekly goal of 90 starting 2026-05-03, then add a 2026-05-04 Sweetgreen lunch for 14.72 to Test Credit Card in Restaurants.",
    assertions: [
      assertGoal("Restaurants", 90, "weekly"),
      assertTransaction({
        account: "Test Credit Card",
        date: "2026-05-04",
        nameIncludes: "Sweetgreen",
        amount: -14.72,
        subcategory: "Restaurants",
      }),
    ],
  },
  {
    suite: "account maintenance",
    name: "credit card rename",
    seed: baseSeed,
    prompt:
      "Rename Test Credit Card to Rewards Visa and add a 2026-05-08 Shell fuel charge for 52.61 on Rewards Visa in Fuel.",
    assertions: [
      assertAccount("Rewards Visa", "liability"),
      assertTransaction({
        account: "Rewards Visa",
        date: "2026-05-08",
        nameIncludes: "Shell",
        amount: -52.61,
        subcategory: "Fuel",
      }),
    ],
  },
  {
    suite: "account maintenance",
    name: "savings interest",
    seed: baseSeed,
    prompt:
      "Add 2026-05-31 interest of 8.42 to Test Savings. If there is no Interest category, create income category Interest and subcategory Bank Interest.",
    assertions: [
      assertCategory("Interest", "income"),
      assertSubcategory("Bank Interest", "Interest"),
      assertTransaction({
        account: "Test Savings",
        date: "2026-05-31",
        nameIncludes: "interest",
        amount: 8.42,
        subcategory: "Bank Interest",
      }),
    ],
  },
  {
    suite: "partial failure",
    name: "valid and invalid mixed request",
    seed: baseSeed,
    prompt:
      "Add a valid 2026-05-18 H Mart grocery charge for 39.81 on Test Checking in Groceries. Also add a transaction to Missing Account for 10.00. Do the valid one even if the missing account fails.",
    assertions: [
      assertTransaction({
        account: "Test Checking",
        date: "2026-05-18",
        nameIncludes: "H Mart",
        amount: -39.81,
        subcategory: "Groceries",
      }),
      assertAnyActionFailed(),
    ],
  },
  {
    suite: "partial failure",
    name: "duplicate category with valid transaction",
    seed: baseSeed,
    prompt:
      "Create category Food again, and also add 2026-05-19 Chipotle 13.55 on Test Credit Card in Restaurants. The transaction should still be recorded even if Food already exists.",
    assertions: [
      assertTransaction({
        account: "Test Credit Card",
        date: "2026-05-19",
        nameIncludes: "Chipotle",
        amount: -13.55,
        subcategory: "Restaurants",
      }),
      assertAnyActionFailed(),
    ],
  },
  {
    suite: "human phrasing",
    name: "relative today handling",
    seed: baseSeed,
    prompt:
      "Today I bought coffee at Blue Bottle for 5.75 on Test Checking. Put it under Restaurants with comment morning coffee.",
    assertions: [
      assertActionCount("create_transaction", 1),
      assertTransaction({
        account: "Test Checking",
        date: new Date().toISOString().slice(0, 10),
        nameIncludes: "Blue Bottle",
        amount: -5.75,
        subcategory: "Restaurants",
        commentIncludes: "morning",
      }),
    ],
  },
  {
    suite: "human phrasing",
    name: "natural correction",
    seed: baseSeed,
    prompt:
      "I said groceries but this was actually a restaurant: add 2026-05-21 Shake Shack 18.04 on Test Credit Card as Restaurants, comment corrected from groceries.",
    assertions: [
      assertTransaction({
        account: "Test Credit Card",
        date: "2026-05-21",
        nameIncludes: "Shake Shack",
        amount: -18.04,
        subcategory: "Restaurants",
        commentIncludes: "corrected",
      }),
    ],
  },
];

async function loadServices(): Promise<ServiceModules> {
  const aiChat = await import("../server/services/ai-chat.js");
  const db = await import("../server/db/index.js");
  const accounts = await import("../server/services/accounts.js");
  const categories = await import("../server/services/categories.js");
  const transactions = await import("../server/services/transactions.js");
  const goals = await import("../server/services/goals.js");

  return {
    chatWithAssistant: aiChat.chatWithAssistant,
    streamChatWithAssistant: aiChat.streamChatWithAssistant,
    getDb: db.getDb,
    closeDbForTests: db.closeDbForTests,
    createAccount: accounts.createAccount,
    createCategory: categories.createCategory,
    createSubcategory: categories.createSubcategory,
    createTransaction: transactions.createTransaction,
    createSpendingGoal: goals.createSpendingGoal,
  };
}

async function runScenario(
  services: ServiceModules,
  scenario: LiveAgentScenario,
): Promise<EvalCaseReport> {
  services.closeDbForTests();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-agent-eval-"));
  const dbPath = path.join(tempDir, "budget.db");
  process.env.LOCALFIN_DB_PATH = dbPath;
  const startedAt = Date.now();

  try {
    seedAgentScenario(services, scenario.seed);
    const streamEvents: ChatStreamEvent[] = [];
    const conversationId = `agent-eval-${crypto.randomUUID()}`;
    const request = {
      conversationId,
      message: scenario.prompt,
      currentPage: "/agent-live-eval",
      maxAssistantTurns: scenario.maxAssistantTurns,
    };
    const result =
      scenario.mode === "stream"
        ? await services.streamChatWithAssistant(request, (event) => {
            streamEvents.push(event);
          })
        : await services.chatWithAssistant(request);
    const snapshot = readAgentSnapshot(services.getDb());
    const actions = result.actions as EvalAction[];
    const context: EvalContext = { result, actions, snapshot, streamEvents };
    const assertions = scenario.assertions.map((assertion) =>
      assertion.check(context),
    );
    const failedAssertions = assertions.filter(
      (assertion) => assertion.status === "fail",
    );

    return {
      suite: scenario.suite,
      name: scenario.name,
      prompt: scenario.prompt,
      status: failedAssertions.length === 0 ? "pass" : "fail",
      durationMs: Date.now() - startedAt,
      actionTypes: actions.map((action) => action.type),
      failedAssertions,
      assertions,
      message: result.message,
      logFile: result.logFile,
      dbPath,
      streamEventTypes: streamEvents.map((event) => event.type),
    };
  } catch (error) {
    return {
      suite: scenario.suite,
      name: scenario.name,
      prompt: scenario.prompt,
      status: "infrastructure_failure",
      durationMs: Date.now() - startedAt,
      actionTypes: [],
      failedAssertions: [],
      assertions: [],
      error: error instanceof Error ? error.message : "Unknown eval error",
      dbPath,
    };
  } finally {
    services.closeDbForTests();
    if (process.env.AGENT_EVAL_KEEP_DBS !== "1") {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

function summarize(cases: EvalCaseReport[]): EvalSuiteSummary[] {
  const suiteNames = [...new Set(cases.map((item) => item.suite))].sort();
  return suiteNames.map((suite) => {
    const suiteCases = cases.filter((item) => item.suite === suite);
    return {
      suite,
      total: suiteCases.length,
      passed: suiteCases.filter((item) => item.status === "pass").length,
      failed: suiteCases.filter((item) => item.status === "fail").length,
      infrastructureFailures: suiteCases.filter(
        (item) => item.status === "infrastructure_failure",
      ).length,
    };
  });
}

function selectedScenarios(): LiveAgentScenario[] {
  const limit = Number(process.env.AGENT_EVAL_LIMIT);
  if (Number.isInteger(limit) && limit > 0) {
    return scenarios.slice(0, limit);
  }
  return scenarios;
}

async function writeReport(report: EvalReport): Promise<void> {
  await mkdir(REPORT_ROOT, { recursive: true });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(path.join(REPORT_ROOT, "latest.json"), text, "utf8");
  await writeFile(
    path.join(REPORT_ROOT, `${report.generatedAt.replace(/[:.]/g, "-")}.json`),
    text,
    "utf8",
  );
}

function printReport(report: EvalReport): void {
  console.log(
    `Agent live eval: ${report.passed}/${report.total} passed, ${report.failed} failed, ${report.infrastructureFailures} infrastructure failures`,
  );
  for (const suite of report.suites) {
    console.log(
      `- ${suite.suite}: ${suite.passed}/${suite.total} passed, ${suite.failed} failed, ${suite.infrastructureFailures} infrastructure failures`,
    );
  }
  for (const item of report.cases.filter(
    (caseReport) => caseReport.status !== "pass",
  )) {
    const failures = item.failedAssertions
      .map(
        (assertion) =>
          `${assertion.name}${assertion.details ? ` (${assertion.details})` : ""}`,
      )
      .join("; ");
    console.log(
      `  FAIL ${item.suite} / ${item.name}: ${item.error ?? failures}`,
    );
  }
}

async function main(): Promise<void> {
  if (process.env.RUN_LIVE_AGENT_EVAL !== "1") {
    throw new Error("Set RUN_LIVE_AGENT_EVAL=1 to run live agent evaluation.");
  }
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is required for live agent evaluation.",
    );
  }

  const services = await loadServices();
  const cases: EvalCaseReport[] = [];
  for (const scenario of selectedScenarios()) {
    console.log(`Running ${scenario.suite} / ${scenario.name}`);
    cases.push(await runScenario(services, scenario));
  }

  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    model: "configured assistantChat model",
    total: cases.length,
    passed: cases.filter((item) => item.status === "pass").length,
    failed: cases.filter((item) => item.status === "fail").length,
    infrastructureFailures: cases.filter(
      (item) => item.status === "infrastructure_failure",
    ).length,
    suites: summarize(cases),
    cases,
  };

  await writeReport(report);
  printReport(report);

  if (report.failed > 0 || report.infrastructureFailures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
