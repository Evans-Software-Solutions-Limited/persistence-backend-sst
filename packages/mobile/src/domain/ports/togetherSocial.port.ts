import type { CloudPage, CloudResult } from "./togetherCloud.port";
import type { TogetherRecoveryPlan } from "./togetherOfflineApi.port";
export interface SocialPerson {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
}
export interface SocialRelationship {
  person?: SocialPerson;
  id: string;
  userId: string;
  friendId: string;
  initiatedBy: string;
  status: "pending" | "accepted";
  createdAt: string;
  updatedAt: string;
}
export interface TemplateOffer {
  id: string;
  senderId: string;
  recipientId: string;
  plan: TogetherRecoveryPlan;
  revoked: boolean;
  createdAt: string;
}
export interface TogetherSocialApi {
  getProfile(): CloudResult<{ discoverable: boolean }>;
  personCode(key: string): CloudResult<{ code: string; expiresAt: string }>;
  resolvePersonCode(code: string): CloudResult<SocialPerson>;
  profile(
    key: string,
    discoverable: boolean,
  ): CloudResult<{ discoverable: boolean }>;
  people(query: string, cursor?: string): CloudResult<CloudPage<SocialPerson>>;
  friends(cursor?: string): CloudResult<CloudPage<SocialRelationship>>;
  requests(cursor?: string): CloudResult<CloudPage<SocialRelationship>>;
  request(
    key: string,
    userId: string,
    personCode?: string,
  ): CloudResult<{ requestId: string; status: string }>;
  decide(
    key: string,
    requestId: string,
    decision: "accept" | "reject",
  ): CloudResult<{ requestId: string; status: string }>;
  remove(key: string, userId: string): CloudResult<{ removed: boolean }>;
  block(
    key: string,
    userId: string,
    blocked: boolean,
  ): CloudResult<{ blocked: boolean }>;
  report(
    key: string,
    body: {
      subjectUserId: string;
      context: "together";
      resourceId?: string;
      reason: "harassment" | "spam" | "unsafe" | "other";
      details?: string;
    },
  ): CloudResult<{ reportId: string }>;
  offer(
    key: string,
    recipientUserId: string,
    plan: TogetherRecoveryPlan,
  ): CloudResult<{ shareId: string }>;
  offers(cursor?: string): CloudResult<CloudPage<TemplateOffer>>;
  template(id: string): CloudResult<TemplateOffer>;
  copy(key: string, id: string): CloudResult<{ workoutId: string }>;
  revoke(key: string, id: string): CloudResult<{ revoked: boolean }>;
}
