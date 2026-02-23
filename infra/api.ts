export const coreAPI = new sst.aws.ApiGatewayV2("api-core");
export const otherServiceAPI = new sst.aws.ApiGatewayV2("api-other-service");

coreAPI.route("$default", "microservices/core/src/api.handler");
otherServiceAPI.route(
  "$default",
  "microservices/other-service/src/api.handler",
);

// api.addAuthorizer
