import { resolveBlobDownloadUrl } from "../blob-url";

describe("resolveBlobDownloadUrl", () => {
  it("resolves the author's PDS and builds the standard blob endpoint", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        service: [
          {
            type: "AtprotoPersonalDataServer",
            serviceEndpoint: "https://pds.example.com/",
          },
        ],
      }),
    });

    const url = await resolveBlobDownloadUrl(
      "did:plc:author",
      "bafy-content",
      fetcher as unknown as typeof fetch,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://plc.directory/did%3Aplc%3Aauthor",
    );
    expect(url).toBe(
      "https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aauthor&cid=bafy-content",
    );
  });

  it("fails explicitly when the DID document has no PDS", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ service: [] }),
    });

    await expect(
      resolveBlobDownloadUrl(
        "did:plc:author",
        "bafy-content",
        fetcher as unknown as typeof fetch,
      ),
    ).rejects.toThrow("No personal data server found");
  });
});
