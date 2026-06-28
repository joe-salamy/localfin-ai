import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { ENV_KEYS, PROVIDER_CONFIG } from "../config/app.js";
import {
  createAkoyaAuthorizationUrl,
  createPlaidLinkToken,
  disconnectProviderConnection,
  exchangePlaidPublicToken,
  handleAkoyaCallback,
  listProviderConnections,
  syncProviderConnections,
} from "../services/account-linking.js";
import { idParamSchema, nonEmptyString, parseRequest } from "./validation.js";

const router = Router();

const plaidTargetInstitutionSchema = z.enum(["us_bank", "discover"]);
const akoyaTargetInstitutionSchema = z.enum(["fidelity"]);

const plaidLinkTokenSchema = z.object({
  targetInstitution: plaidTargetInstitutionSchema,
});

const plaidExchangeSchema = z.object({
  publicToken: nonEmptyString,
  targetInstitution: plaidTargetInstitutionSchema,
  metadata: z.unknown(),
});

const akoyaAuthorizeSchema = z.object({
  targetInstitution: akoyaTargetInstitutionSchema,
});

const akoyaCallbackSchema = z.object({
  code: nonEmptyString.optional(),
  state: nonEmptyString.optional(),
  error: z.string().trim().min(1).optional(),
});

const syncSchema = z.object({
  connectionId: nonEmptyString.optional(),
});

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function frontendBaseUrl() {
  return process.env[ENV_KEYS.frontendBaseUrl] ?? PROVIDER_CONFIG.frontendBaseUrl;
}

router.get("/connections", (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: listProviderConnections() });
  } catch (error) {
    res.status(400).json({ success: false, error: errorMessage(error) });
  }
});

router.post("/plaid/link-token", async (req: Request, res: Response) => {
  try {
    const body = parseRequest(plaidLinkTokenSchema, req.body, res);
    if (!body) return;
    const data = await createPlaidLinkToken(body.targetInstitution);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: errorMessage(error) });
  }
});

router.post("/plaid/exchange", async (req: Request, res: Response) => {
  try {
    const body = parseRequest(plaidExchangeSchema, req.body, res);
    if (!body) return;
    const data = await exchangePlaidPublicToken(body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: errorMessage(error) });
  }
});

router.post("/akoya/authorize", (req: Request, res: Response) => {
  try {
    const body = parseRequest(akoyaAuthorizeSchema, req.body, res);
    if (!body) return;
    const data = createAkoyaAuthorizationUrl(body.targetInstitution);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: errorMessage(error) });
  }
});

router.get("/akoya/callback", async (req: Request, res: Response) => {
  try {
    const query = parseRequest(akoyaCallbackSchema, req.query, res);
    if (!query) return;
    if (query.error) {
      res.redirect(
        `${frontendBaseUrl()}/setup?provider=akoya&status=error&message=${encodeURIComponent(
          query.error,
        )}`,
      );
      return;
    }
    if (!query.code || !query.state) {
      res.redirect(
        `${frontendBaseUrl()}/setup?provider=akoya&status=error&message=${encodeURIComponent(
          "Missing Akoya callback code or state",
        )}`,
      );
      return;
    }
    await handleAkoyaCallback({ code: query.code, state: query.state });
    res.redirect(`${frontendBaseUrl()}/setup?provider=akoya&status=connected`);
  } catch (error) {
    res.redirect(
      `${frontendBaseUrl()}/setup?provider=akoya&status=error&message=${encodeURIComponent(
        errorMessage(error),
      )}`,
    );
  }
});

router.post("/sync", async (req: Request, res: Response) => {
  try {
    const body = parseRequest(syncSchema, req.body ?? {}, res);
    if (!body) return;
    const data = await syncProviderConnections(body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = errorMessage(error);
    const status = message.includes("not found") ? 404 : 400;
    res.status(status).json({ success: false, error: message });
  }
});

router.delete("/connections/:id", async (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    if (!params) return;
    await disconnectProviderConnection(params.id);
    res.json({ success: true });
  } catch (error) {
    const message = errorMessage(error);
    const status = message.includes("not found") ? 404 : 400;
    res.status(status).json({ success: false, error: message });
  }
});

export const accountLinkingRouter = router;
