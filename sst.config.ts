/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "sst-monorepo-template",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
    };
  },
  async run() {
    const api = await import("./infra/api");
    const web = await import("./infra/web");
    return {
      api: api.coreAPI.url,
      web: $dev ? "http://localhost:5173" : web.frontend.url,
    };
  },
});
