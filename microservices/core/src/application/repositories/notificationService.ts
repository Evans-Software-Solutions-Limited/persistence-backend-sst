import Elysia from "elysia";
import { NotificationRepository } from "./notificationRepository";

export const NotificationService = new Elysia({
  name: "NotificationService",
}).decorate("NotificationRepository", new NotificationRepository());
