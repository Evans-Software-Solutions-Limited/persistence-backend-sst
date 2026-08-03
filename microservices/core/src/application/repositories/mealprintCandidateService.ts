import Elysia from "elysia";
import { MealprintCandidateRepository } from "./mealprintCandidateRepository";

export const MealprintCandidateService = new Elysia({
  name: "MealprintCandidateService",
}).decorate("MealprintCandidateRepository", new MealprintCandidateRepository());
