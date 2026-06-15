import Elysia from "elysia";
import { HomeReadRepository } from "./homeReadRepository";

export const HomeReadService = new Elysia({
  name: "HomeReadService",
}).decorate("HomeReadRepository", new HomeReadRepository());
