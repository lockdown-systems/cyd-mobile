type DidDocument = {
  service?: {
    type?: string;
    serviceEndpoint?: string;
  }[];
};

function didDocumentUrl(did: string): string {
  if (did.startsWith("did:plc:")) {
    return `https://plc.directory/${encodeURIComponent(did)}`;
  }

  if (did.startsWith("did:web:")) {
    const parts = did.slice("did:web:".length).split(":").map(decodeURIComponent);
    const host = parts.shift();
    if (!host) throw new Error(`Invalid did:web identifier: ${did}`);
    const path = parts.length > 0 ? `/${parts.join("/")}/did.json` : "/.well-known/did.json";
    return `https://${host}${path}`;
  }

  throw new Error(`Unsupported DID method for media download: ${did}`);
}

export async function resolveBlobDownloadUrl(
  did: string,
  contentCid: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher(didDocumentUrl(did));
  if (!response.ok) {
    throw new Error(`Unable to resolve media source for ${did}`);
  }

  const document = (await response.json()) as DidDocument;
  const pds = document.service?.find(
    ({ type, serviceEndpoint }) =>
      type === "AtprotoPersonalDataServer" &&
      typeof serviceEndpoint === "string",
  )?.serviceEndpoint;
  if (!pds) {
    throw new Error(`No personal data server found for ${did}`);
  }

  const params = new URLSearchParams({ did, cid: contentCid });
  return `${pds.replace(/\/$/, "")}/xrpc/com.atproto.sync.getBlob?${params}`;
}
