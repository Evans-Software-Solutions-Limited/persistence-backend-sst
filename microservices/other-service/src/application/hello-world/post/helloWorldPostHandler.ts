import Elysia, { t } from "elysia";
import { HelloWorldPostRepositoryService } from "./helloWorldPostService";

export const postHelloWorldHandler = new Elysia()
  .use(HelloWorldPostRepositoryService)
  .post(
    "/hello-world",
    async (ctx) => {
      const message = await ctx.HelloWorldRepository.create("World");
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
