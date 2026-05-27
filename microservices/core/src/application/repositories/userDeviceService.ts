import Elysia from "elysia";
import { UserDeviceRepository } from "./userDeviceRepository";

export const UserDeviceService = new Elysia({
  name: "UserDeviceService",
}).decorate("UserDeviceRepository", new UserDeviceRepository());
