import { databaseUrl } from "./secrets";
import { coreApiDomain } from "./domains";

// Custom domain only on stable named stages (production / staging). Personal
// dev stages fall back to the auto-generated API Gateway URL — the mobile
// client points at staging via EXPO_PUBLIC_API_URL during local development.
// See docs/mobile-release-pipeline.md and packages/api-utils/src/domains/.
export const coreAPI = new sst.aws.ApiGatewayV2("api-core", {
  domain: coreApiDomain != null ? { name: coreApiDomain } : undefined,
});

export const otherServiceAPI = new sst.aws.ApiGatewayV2("api-other-service");

coreAPI.route("$default", {
  handler: "microservices/core/src/api.handler",
  environment: {
    DATABASE_URL: databaseUrl.value,
    SUPABASE_URL: process.env.SUPABASE_URL ?? "",
  },
});

otherServiceAPI.route("$default", {
  handler: "microservices/other-service/src/api.handler",
  environment: {
    DATABASE_URL: databaseUrl.value,
    SUPABASE_URL: process.env.SUPABASE_URL ?? "",
  },
});

// api.addAuthorizer
