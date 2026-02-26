import { databaseUrl } from "./secrets";

export const coreAPI = new sst.aws.ApiGatewayV2("api-core");
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
