export type {
  AccountLinkProvider,
  AkoyaAuthorizationResult,
  PlaidLinkTokenResult,
  ProviderAccountSummary,
  ProviderConnectionStatus,
  ProviderConnectionSummary,
  ProviderSyncResult,
  TargetInstitution,
} from "../../shared/contracts/index.js";
export type {
  AkoyaProviderClient,
  PlaidProviderClient,
} from "./providers/types.js";
export {
  accountLinkingService,
  createAccountLinkingService,
} from "./account-linking/service.js";
export type {
  AccountLinkingDependencies,
  AccountLinkingService,
} from "./account-linking/service.js";
