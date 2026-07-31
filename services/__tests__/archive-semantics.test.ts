import { normalizeBlueskyArchiveSemantics } from "../archive-semantics";

describe("Bluesky archive semantic normalization", () => {
  it("translates canonical wire names without exposing table layout to consumers", () => {
    expect(
      normalizeBlueskyArchiveSemantics({
        archive: [
          {
            created_at: "2026-01-15T12:00:00.000Z",
            account_did: "did:plc:alice",
            account_uuid: "018d5f7a-9b3c-7d10-8a2e-1f4c6b8d0e12",
            completeness: "complete",
          },
        ],
        identity: [
          { did: "did:plc:alice", current_profile_id: "profile-alice" },
        ],
        profiles: [],
        records: [],
        selections: [],
        record_subjects: [],
        record_context: [],
        conversations: [],
        conversation_members: [],
        messages: [],
        relationships: [],
        record_assets: [],
        portable_settings: [],
        assets: [],
      }),
    ).toEqual({
      commonSemantics: {
        archive: {
          createdAt: "2026-01-15T12:00:00.000Z",
          accountDid: "did:plc:alice",
          accountUuid: "018d5f7a-9b3c-7d10-8a2e-1f4c6b8d0e12",
        },
        identity: { did: "did:plc:alice", currentProfileId: "profile-alice" },
        profiles: [],
        records: [],
        selections: [],
        recordSubjects: [],
        recordContext: [],
        conversations: [],
        conversationMembers: [],
        messages: [],
        relationships: [],
        recordAssets: [],
        portableSettings: [],
      },
      assets: [],
      completeness: "complete",
    });
  });
});
