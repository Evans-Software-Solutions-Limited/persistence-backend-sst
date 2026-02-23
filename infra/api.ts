import { databaseUrl, jwtSecret } from "./secrets";

export const coreAPI = new sst.aws.ApiGatewayV2("api-core");
export const otherServiceAPI = new sst.aws.ApiGatewayV2("api-other-service");

coreAPI.route("$default", {
  handler: "microservices/core/src/api.handler",
  environment: {
    DATABASE_URL: databaseUrl.value,
    JWT_SECRET: jwtSecret.value,
  },
});

otherServiceAPI.route("$default", {
  handler: "microservices/other-service/src/api.handler",
  environment: {
    DATABASE_URL: databaseUrl.value,
    JWT_SECRET: jwtSecret.value,
  },
});

// api.addAuthorizer
