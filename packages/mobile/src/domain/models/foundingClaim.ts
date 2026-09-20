export interface FoundingClaimChallenge {
  challengeId: string;
}

export interface FoundingClaimResult {
  claimed: true;
  tierName: string;
  expiresAt: string | null;
}
