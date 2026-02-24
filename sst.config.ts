/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    const stage = input?.stage ?? "dev";
    return {
      name: "persistence-api",
      removal: stage === "production" ? "retain" : "remove",
      protect: stage === "production",
      home: "aws",
      providers: {
        aws: {
          defaultTags: {
            tags: {
              App: "persistence-api",
              Stage: stage,
            },
          },
        },
      },
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
