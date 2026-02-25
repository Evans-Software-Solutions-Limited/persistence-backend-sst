import Elysia, { t } from "elysia";
import { HelloWorldPostRepositoryService } from "./helloWorldPostService";

export const postHelloWorldController = new Elysia()
  .use(HelloWorldPostRepositoryService)
  .post(
    "/hello-world-custom",
    async (ctx) => {
      const message = await ctx.HelloWorldRepository.create("CustomUser");
      return { message };
    },
    {
      response: {
        200: t.Object({
          message: t.String(),
        }),
      },
    },
  );
