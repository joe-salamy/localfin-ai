import { Router } from "express";
import type { Request, Response } from "express";
import { API_ROUTES } from "../config/app.js";

export const openApiRouter = Router();

// Minimal but valid OpenAPI 3.0.3 spec. Handwritten to avoid zod-to-openapi coupling.
// Reuses route table from API_ROUTES and documents envelope shapes.
const spec = {
  openapi: "3.0.3",
  info: {
    title: "LocalFin",
    version: "0.1.0",
    description:
      "Local-first finance API. Loopback-only (127.0.0.1:3001). Envelope: {success, data, error}. See shared/contracts and .omp/skills/localfin-api.",
  },
  servers: [{ url: "http://127.0.0.1:3001" }],
  paths: {
    "/api/health": {
      get: {
        summary: "Health check",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    timestamp: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/accounts": {
      get: {
        summary: "List accounts with balances",
        responses: { "200": { description: "Account list" } },
      },
      post: {
        summary: "Create account",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/accounts/{id}": {
      get: { summary: "Get account", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Account" } } },
      put: { summary: "Update account", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" } } },
      delete: { summary: "Delete account", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Deleted" } } },
    },
    "/api/categories": {
      get: { summary: "List categories", responses: { "200": { description: "Categories" } } },
      post: { summary: "Create category", responses: { "201": { description: "Created" } } },
    },
    "/api/subcategories": {
      get: { summary: "List subcategories", responses: { "200": { description: "Subcategories" } } },
      post: { summary: "Create subcategory", responses: { "201": { description: "Created" } } },
    },
    "/api/tags": {
      get: { summary: "List tags", responses: { "200": { description: "Tags" } } },
      post: { summary: "Create tag", responses: { "201": { description: "Created" } } },
    },
    "/api/transactions": {
      get: {
        summary: "List/search transactions",
        parameters: [
          { name: "searchQuery", in: "query", required: false, schema: { type: "string" }, description: "Rich search: quoted phrases, (parens), AND/OR/NOT, |, -term, fields name:/comment:/account:/category:/subcategory:/tag:/tags:, amount>20, date>=2026-01-01" },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
          { name: "accountId", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Transactions envelope {success:true, data:[...]}" } },
      },
      post: { summary: "Create transaction", responses: { "201": { description: "Created" } } },
    },
    "/api/transactions/bulk": {
      post: { summary: "Bulk create transactions", responses: { "201": { description: "Created" } } },
      put: { summary: "Bulk update transactions", responses: { "200": { description: "Updated" } } },
      delete: { summary: "Bulk delete transactions", responses: { "200": { description: "Deleted" } } },
    },
    "/api/transactions/{id}": {
      get: { summary: "Get transaction", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Transaction" } } },
      put: { summary: "Update transaction", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" } } },
      delete: { summary: "Delete transaction", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Deleted" } } },
    },
    "/api/dashboard/account-summary": {
      get: { summary: "Dashboard account summary", responses: { "200": { description: "Account summary" } } },
    },
    "/api/dashboard/category-summary": {
      get: { summary: "Dashboard category summary", responses: { "200": { description: "Category summary" } } },
    },
    "/api/dashboard/metrics": {
      get: { summary: "Dashboard metrics", responses: { "200": { description: "Metrics" } } },
    },
    "/api/dashboard/charts/net-worth": {
      get: { summary: "Net worth chart", responses: { "200": { description: "Chart data" } } },
    },
    "/api/dashboard/charts/sankey": {
      get: { summary: "Sankey chart", responses: { "200": { description: "Chart data" } } },
    },
    "/api/goals": {
      get: { summary: "List goals", responses: { "200": { description: "Goals" } } },
      post: { summary: "Create goal", responses: { "201": { description: "Created" } } },
    },
    "/api/goals/{id}": {
      get: { summary: "Get goal", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Goal" } } },
      put: { summary: "Update goal", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" } } },
      delete: { summary: "Delete goal", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Deleted" } } },
    },
    "/api/parser/parse-statement": {
      post: {
        summary: "Parse statement text into transactions",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" }, accountId: { type: "string" } } } } } },
        responses: { "200": { description: "ParseStatementResult" } },
      },
    },
    "/api/account-linking/connections": {
      get: { summary: "List provider connections", responses: { "200": { description: "Connections" } } },
    },
    "/api/openapi.json": {
      get: { summary: "OpenAPI spec", responses: { "200": { description: "OpenAPI JSON" } } },
    },
  },
  components: {
    schemas: {
      ApiEnvelope: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: {},
          error: { type: "string" },
        },
      },
    },
  },
  // Mirror API_ROUTES for discoverability
  "x-api-routes": API_ROUTES,
} as const;

function handler(_req: Request, res: Response): void {
  res.json(spec);
}

openApiRouter.get("/", handler);
openApiRouter.get("/openapi.json", handler);
