import Elysia from "elysia";
import { HelloWorldRepository } from "../../repositories/helloWorldRepository";

export const HelloWorldPostRepositoryService = new Elysia().decorate(
  "HelloWorldRepository",
  new HelloWorldRepository(),
);
