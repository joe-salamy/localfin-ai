import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { ENV_KEYS, PROVIDER_CONFIG } from "../config/app.js";
import { publicErrorMessage } from "../errors.js";
import { accountLinkingService } from "../services/account-linking.js";
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

function frontendBaseUrl() {
  return (
    process.env[ENV_KEYS.frontendBaseUrl] ?? PROVIDER_CONFIG.frontendBaseUrl
  );
}

router.get("/connections", (_req: Request, res: Response) => {
  res.json({ success: true, data: accountLinkingService.listProviderConnections() });
});

router.post("/plaid/link-token", async (req: Request, res: Response) => {
  const body = parseRequest(plaidLinkTokenSchema, req.body);
  const data = await accountLinkingService.createPlaidLinkToken(body.targetInstitution);
  res.json({ success: true, data });
});

router.post("/plaid/exchange", async (req: Request, res: Response) => {
  const body = parseRequest(plaidExchangeSchema, req.body);
  const data = await accountLinkingService.exchangePlaidPublicToken(body);
  res.status(201).json({ success: true, data });
});

router.post("/akoya/authorize", (req: Request, res: Response) => {
  const body = parseRequest(akoyaAuthorizeSchema, req.body);
  const data = accountLinkingService.createAkoyaAuthorizationUrl(body.targetInstitution);
  res.status(201).json({ success: true, data });
});

router.get("/akoya/callback", async (req: Request, res: Response) => {
  try {
    const query = parseRequest(akoyaCallbackSchema, req.query);
    if (query.error) {
      res.redirect(
        `${frontendBaseUrl()}/setup?provider=akoya&status=error&message=${encodeURIComponent(query.error)}`,
      );
      return;
    }
    if (!query.code || !query.state) {
      res.redirect(
        `${frontendBaseUrl()}/setup?provider=akoya&status=error&message=${encodeURIComponent("Missing Akoya callback code or state")}`,
      );
      return;
    }
    await accountLinkingService.handleAkoyaCallback({ code: query.code, state: query.state });
    res.redirect(`${frontendBaseUrl()}/setup?provider=akoya&status=connected`);
  } catch (error) {
    res.redirect(
      `${frontendBaseUrl()}/setup?provider=akoya&status=error&message=${encodeURIComponent(publicErrorMessage(error))}`,
    );
  }
});

router.post("/sync", async (req: Request, res: Response) => {
  const body = parseRequest(syncSchema, req.body ?? {});
  const data = await accountLinkingService.syncProviderConnections(body);
  res.status(201).json({ success: true, data });
});

router.delete("/connections/:id", async (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);
  await accountLinkingService.disconnectProviderConnection(params.id);
  res.json({ success: true });
});

export const accountLinkingRouter = router;
