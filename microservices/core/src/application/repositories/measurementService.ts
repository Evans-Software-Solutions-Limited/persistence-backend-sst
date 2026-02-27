import Elysia from "elysia";
import { MeasurementRepository } from "./measurementRepository";

export const MeasurementService = new Elysia({
  name: "MeasurementService",
}).decorate("MeasurementRepository", new MeasurementRepository());
