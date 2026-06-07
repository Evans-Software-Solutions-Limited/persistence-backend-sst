import Elysia from "elysia";
import { VolumeRepository } from "./volumeRepository";

export const VolumeService = new Elysia({
  name: "VolumeService",
}).decorate("VolumeRepository", new VolumeRepository());
