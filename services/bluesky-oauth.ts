import "@/services/polyfills";

import { Agent } from "@atproto/api";
import type { Jwk, Key } from "@atproto/jwk";
import { JoseKey } from "@atproto/jwk-jose";
import {
  OAuthClient,
  type AuthorizeOptions,
  type DigestAlgorithm,
  type InternalStateData,
  type OAuthSession,
  type Session as PersistedSession,
  type RuntimeImplementation,
  type SessionStore,
  type StateStore,
} from "@atproto/oauth-client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";

import { getDatabase } from "@/database";
import { saveAuthenticatedBlueskyAccount } from "@/database/accounts";

const STATE_PREFIX = "@cyd/bluesky/state/";
const SESSION_PREFIX = "@cyd/bluesky/session/";
const CLIENT_METADATA_PATH = "bluesky/client-metadata-mobile.json";
const PROD_HOST = "api.cyd.social";
const DEV_HOST = "dev-api.cyd.social";
const REDIRECT_URI = __DEV__
  ? "social.cyd.dev-api:/oauth/bluesky"
  : "social.cyd.api:/oauth/bluesky";

let clientPromise: Promise<OAuthClient> | null = null;
const stateStore = createStateStore();
const sessionStore = createSessionStore();
const runtimeImplementation = createRuntimeImplementation();
type OAuthRedirectUri = NonNullable<AuthorizeOptions["redirect_uri"]>;

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "").toLowerCase();
}

async function getClient(): Promise<OAuthClient> {
  if (!clientPromise) {
    clientPromise = initClient();
  }

  return clientPromise;
}

async function initClient(): Promise<OAuthClient> {
  const host = __DEV__ ? DEV_HOST : PROD_HOST;
  const clientId =
    `https://${host}/${CLIENT_METADATA_PATH}` as `https://${string}/${string}`;
  const clientMetadata = await OAuthClient.fetchMetadata({ clientId });

  return new OAuthClient({
    clientMetadata,
    responseMode: "query",
    stateStore,
    sessionStore,
    runtimeImplementation,
    handleResolver: "https://bsky.social",
  });
}

export async function restoreBlueskyOAuthSession(
  did: string,
  refresh?: boolean | "auto"
): Promise<OAuthSession> {
  const normalizedDid = did?.trim();
  if (!normalizedDid) {
    throw new Error("Missing Bluesky DID for session restore");
  }
  const client = await getClient();
  return client.restore(normalizedDid, refresh);
}

function stateKey(key: string): string {
  return `${STATE_PREFIX}${key}`;
}

function sessionKey(sub: string): string {
  return `${SESSION_PREFIX}${sub}`;
}

export async function authenticateBlueskyAccount(handleInput: string) {
  const sanitizedHandle = normalizeHandle(handleInput);
  if (!sanitizedHandle) {
    throw new Error("Enter your Bluesky handle");
  }
  console.log("[BlueskyOAuth] authenticate -> start", sanitizedHandle);

  const client = await getClient();
  const redirectUri = REDIRECT_URI as unknown as OAuthRedirectUri;

  const authUrl = await client.authorize(sanitizedHandle, {
    redirect_uri: redirectUri,
  });
  console.log("[BlueskyOAuth] authorize URL created", sanitizedHandle);

  const result = await WebBrowser.openAuthSessionAsync(
    authUrl.toString(),
    redirectUri
  );
  console.log("[BlueskyOAuth] auth session result", result.type);

  if (result.type !== "success") {
    if (
      result.type === WebBrowser.WebBrowserResultType.CANCEL ||
      result.type === WebBrowser.WebBrowserResultType.DISMISS
    ) {
      throw new Error("Authentication canceled");
    }
    throw new Error("Authentication failed. Please try again.");
  }

  const params = new URL(result.url).searchParams;

  const { session } = await client.callback(params, {
    redirect_uri: redirectUri,
  });
  console.log("[BlueskyOAuth] callback complete", sanitizedHandle);

  const agent = new Agent(session);
  const profileResponse = await agent.getProfile({ actor: session.did });
  console.log("[BlueskyOAuth] profile fetched", sanitizedHandle);

  return saveAuthenticatedBlueskyAccount({
    session,
    profile: profileResponse.data,
  });
}

export async function revokeBlueskyAuthorization(
  accountId: number
): Promise<void> {
  console.log("[BlueskyOAuth] revoke -> start", accountId);
  const db = await getDatabase();
  const accountRow = await db.getFirstAsync<{
    bskyAccountID: number;
    sessionJson: string | null;
  }>(
    `SELECT a.bskyAccountID, b.sessionJson
       FROM account a
       INNER JOIN bsky_account b ON b.id = a.bskyAccountID
      WHERE a.id = ?
      LIMIT 1;`,
    [accountId]
  );

  if (!accountRow?.bskyAccountID) {
    throw new Error("Unable to locate this Bluesky account");
  }

  if (accountRow.sessionJson) {
    try {
      const storedSession = JSON.parse(
        accountRow.sessionJson
      ) as Partial<PersistedSession> & { sub?: string };
      const subject = storedSession.sub;
      if (typeof subject === "string" && subject.length > 0) {
        await sessionStore.del(subject);
        console.log("[BlueskyOAuth] revoke -> cleared session store", subject);
      }
    } catch (err) {
      console.warn("Failed to clear cached Bluesky session", err);
    }
  }

  await db.runAsync(
    `UPDATE bsky_account
        SET sessionJson = NULL,
            accessJwt = NULL,
            refreshJwt = NULL,
            updatedAt = ?
      WHERE id = ?;`,
    [Date.now(), accountRow.bskyAccountID]
  );
  console.log("[BlueskyOAuth] revoke -> db session cleared", accountId);
}

type SerializedState = Omit<InternalStateData, "dpopKey"> & {
  dpopKeyJwk: Jwk;
};

type SerializedSession = Omit<PersistedSession, "dpopKey"> & {
  dpopKeyJwk: Jwk;
};

function createStateStore(): StateStore {
  return {
    async set(key, value) {
      const serialized = serializeState(value);
      await AsyncStorage.setItem(stateKey(key), JSON.stringify(serialized));
    },
    async get(key) {
      const raw = await AsyncStorage.getItem(stateKey(key));
      if (!raw) {
        return undefined;
      }
      const parsed = JSON.parse(raw) as SerializedState;
      return deserializeState(parsed);
    },
    async del(key) {
      await AsyncStorage.removeItem(stateKey(key));
    },
  };
}

function createSessionStore(): SessionStore {
  return {
    async set(sub, value) {
      const serialized = serializeSession(value);
      await AsyncStorage.setItem(sessionKey(sub), JSON.stringify(serialized));
    },
    async get(sub) {
      const raw = await AsyncStorage.getItem(sessionKey(sub));
      if (!raw) {
        return undefined;
      }
      const parsed = JSON.parse(raw) as SerializedSession;
      return deserializeSession(parsed);
    },
    async del(sub) {
      await AsyncStorage.removeItem(sessionKey(sub));
    },
  };
}

function serializeState(value: InternalStateData): SerializedState {
  const { dpopKey, ...rest } = value;
  return { ...rest, dpopKeyJwk: serializeKey(dpopKey) };
}

async function deserializeState(
  value: SerializedState
): Promise<InternalStateData> {
  const { dpopKeyJwk, ...rest } = value;
  return { ...rest, dpopKey: await deserializeKey(dpopKeyJwk) };
}

function serializeSession(value: PersistedSession): SerializedSession {
  const { dpopKey, ...rest } = value;
  return { ...rest, dpopKeyJwk: serializeKey(dpopKey) };
}

async function deserializeSession(
  value: SerializedSession
): Promise<PersistedSession> {
  const { dpopKeyJwk, ...rest } = value;
  return { ...rest, dpopKey: await deserializeKey(dpopKeyJwk) };
}

function serializeKey(key: Key): Jwk {
  const jwk = key.privateJwk;
  if (!jwk) {
    throw new Error("DPoP key is missing private key material");
  }
  return jwk;
}

async function deserializeKey(jwk: Jwk) {
  return JoseKey.fromJWK(jwk);
}

function createRuntimeImplementation(): RuntimeImplementation {
  const locks = new Map<string, Promise<void>>();

  return {
    createKey: (algs) => JoseKey.generate(algs),
    getRandomValues: (length) => {
      const cryptoInstance = ensureCrypto();
      const buffer = new Uint8Array(length);
      return cryptoInstance.getRandomValues(buffer);
    },
    digest: async (data, algorithm) => {
      const cryptoInstance = ensureCrypto();
      if (!cryptoInstance.subtle) {
        throw new Error("SubtleCrypto API is unavailable");
      }
      const algo = mapDigestAlgorithm(algorithm);
      const digestInput = data.slice().buffer;
      const result = await cryptoInstance.subtle.digest(algo, digestInput);
      return new Uint8Array(result);
    },
    requestLock: async (name, fn) => {
      const previous = locks.get(name) ?? Promise.resolve();
      let release: () => void = () => {};
      const current = previous.then(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );
      locks.set(name, current);
      await previous;
      try {
        return await fn();
      } finally {
        release();
        if (locks.get(name) === current) {
          locks.delete(name);
        }
      }
    },
  };
}

function ensureCrypto(): Crypto {
  if (!globalThis.crypto) {
    throw new Error("WebCrypto API is unavailable in this environment");
  }
  return globalThis.crypto;
}

function mapDigestAlgorithm(algorithm: DigestAlgorithm): AlgorithmIdentifier {
  switch (algorithm.name) {
    case "sha256":
      return "SHA-256";
    case "sha384":
      return "SHA-384";
    case "sha512":
      return "SHA-512";
    default:
      throw new Error("Unsupported digest algorithm");
  }
}
