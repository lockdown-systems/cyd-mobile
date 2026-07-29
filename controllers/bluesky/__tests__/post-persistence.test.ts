import type { AppBskyFeedDefs } from "@atproto/api";
import type { SQLiteDatabase } from "expo-sqlite";

import {
  createPostWithImages,
  createPostWithVideo,
  makePostRecordRecognizable,
} from "@/testUtils/blueskyFixtures";
import { createMockDatabase } from "@/testUtils/mockDatabase";
import { PostPersistence } from "../post-persistence";
function withImageCid(): AppBskyFeedDefs.FeedViewPost {
  const item = makePostRecordRecognizable(createPostWithImages(1));
  const embed = item.post.embed as { images: { fullsize: string }[] };
  embed.images[0].fullsize =
    "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:author/bafy-image@jpeg";
  return item;
}

function withVideoCid(): AppBskyFeedDefs.FeedViewPost {
  const item = makePostRecordRecognizable(createPostWithVideo());
  (item.post.embed as { cid?: string }).cid = "bafy-video";
  return item;
}

describe("PostPersistence media preservation", () => {
  it.each([
    ["full image", withImageCid(), "bafy-image", "file:///account/media/bafy-image"],
    ["full video", withVideoCid(), "bafy-video", "file:///account/media/bafy-video"],
  ])("preserves a %s by content identity", async (_label, feedItem, cid, localUri) => {
    const db = createMockDatabase();
    const downloadMedia = jest.fn().mockResolvedValue(localUri);
    const persistence = new PostPersistence({
      downloadMedia,
      downloadMediaFromUrl: jest.fn(),
      getDid: () => "did:plc:owner",
    });

    const preview = await persistence.persistPostView(db, feedItem.post);

    expect(downloadMedia).toHaveBeenCalledWith(cid, feedItem.post.author.did);
    expect(preview?.media?.[0]).toMatchObject({
      contentCid: cid,
      localUri,
      downloadState: "complete",
    });
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("downloadState = 'complete'"),
      expect.arrayContaining([localUri, cid]),
    );
  });

  it("keeps a failed asset explicit and retries it when the record is saved again", async () => {
    const db = createMockDatabase({
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          downloadState: "failed",
          localPath: null,
        }),
    });
    const downloadMedia = jest
      .fn()
      .mockRejectedValueOnce(new Error("source unavailable"))
      .mockResolvedValueOnce("file:///account/media/bafy-image");
    const persistence = new PostPersistence({
      downloadMedia,
      downloadMediaFromUrl: jest.fn(),
      getDid: () => "did:plc:owner",
    });
    const feedItem = withImageCid();

    const failed = await persistence.persistPostView(db, feedItem.post);
    const retried = await persistence.persistPostView(db, feedItem.post);

    expect(failed?.media?.[0]).toMatchObject({
      downloadState: "failed",
      downloadError: "source unavailable",
    });
    expect(retried?.media?.[0]).toMatchObject({
      downloadState: "complete",
      localUri: "file:///account/media/bafy-image",
    });
    expect(downloadMedia).toHaveBeenCalledTimes(2);
  });

  it("does not download an already complete account-local asset again", async () => {
    const db = createMockDatabase({
      getFirstAsync: jest.fn().mockResolvedValue({
        downloadState: "complete",
        localPath: "file:///account/media/bafy-image",
      }),
    });
    const downloadMedia = jest.fn();
    const persistence = new PostPersistence({
      downloadMedia,
      downloadMediaFromUrl: jest.fn(),
      getDid: () => "did:plc:owner",
    });

    const preview = await persistence.persistPostView(db, withImageCid().post);

    expect(downloadMedia).not.toHaveBeenCalled();
    expect(preview?.media?.[0].localUri).toBe(
      "file:///account/media/bafy-image",
    );
  });
});
