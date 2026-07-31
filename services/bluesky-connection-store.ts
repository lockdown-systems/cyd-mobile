import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const CONNECTION_PREFIX = "cyd.bluesky.connection.";
const LEGACY_SESSION_PREFIX = "@cyd/bluesky/session/";
const OAUTH_STATE_PREFIX = "cyd.bluesky.oauth-state.";
const LEGACY_STATE_PREFIX = "@cyd/bluesky/state/";
const DISCONNECTED = "__cyd_disconnected__";

type GetBlueskyConnectionOptions = {
  accountUUID: string;
  legacyDid?: string;
  legacyConnection?: string | null;
};

function connectionKey(accountUUID: string): string {
  const normalizedUUID = accountUUID.trim();
  if (!normalizedUUID) {
    throw new Error("Missing Bluesky local-account UUID");
  }
  return `${CONNECTION_PREFIX}${normalizedUUID}`;
}

function legacySessionKey(did: string): string {
  return `${LEGACY_SESSION_PREFIX}${did}`;
}

function oauthStateKey(state: string): string {
  const encodedState = Array.from(state)
    .map((character) => character.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("");
  if (!encodedState) {
    throw new Error("Missing Bluesky OAuth state key");
  }
  return `${OAUTH_STATE_PREFIX}${encodedState}`;
}

export async function setBlueskyOAuthState(
  state: string,
  serializedState: string,
): Promise<void> {
  await SecureStore.setItemAsync(oauthStateKey(state), serializedState, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

export async function getBlueskyOAuthState(
  state: string,
): Promise<string | null> {
  const key = oauthStateKey(state);
  const protectedState = await SecureStore.getItemAsync(key);
  const legacyKey = `${LEGACY_STATE_PREFIX}${state}`;
  const legacyState = await AsyncStorage.getItem(legacyKey);

  if (protectedState !== null) {
    if (legacyState !== null) {
      await AsyncStorage.removeItem(legacyKey);
    }
    return protectedState === DISCONNECTED ? null : protectedState;
  }
  if (legacyState === null) {
    return null;
  }

  await setBlueskyOAuthState(state, legacyState);
  await AsyncStorage.removeItem(legacyKey);
  return legacyState;
}

export async function deleteBlueskyOAuthState(state: string): Promise<void> {
  const key = oauthStateKey(state);
  await SecureStore.setItemAsync(key, DISCONNECTED, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
  await AsyncStorage.removeItem(`${LEGACY_STATE_PREFIX}${state}`);
  await SecureStore.deleteItemAsync(key);
}

export async function setBlueskyConnection(
  accountUUID: string,
  serializedConnection: string,
): Promise<void> {
  await SecureStore.setItemAsync(
    connectionKey(accountUUID),
    serializedConnection,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED },
  );
}

export async function deleteBlueskyConnection(
  accountUUID: string,
  legacyDid?: string,
): Promise<void> {
  const key = connectionKey(accountUUID);
  await SecureStore.setItemAsync(key, DISCONNECTED, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
  if (legacyDid) {
    await AsyncStorage.removeItem(legacySessionKey(legacyDid));
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getBlueskyConnection({
  accountUUID,
  legacyDid,
  legacyConnection,
}: GetBlueskyConnectionOptions): Promise<string | null> {
  const key = connectionKey(accountUUID);
  const protectedConnection = await SecureStore.getItemAsync(key);

  if (!legacyDid) {
    if (protectedConnection === DISCONNECTED) {
      return null;
    }
    if (protectedConnection === null && legacyConnection != null) {
      await setBlueskyConnection(accountUUID, legacyConnection);
      return legacyConnection;
    }
    return protectedConnection;
  }

  const legacyKey = legacySessionKey(legacyDid);
  const asyncStorageConnection = await AsyncStorage.getItem(legacyKey);
  const connectionToMigrate = asyncStorageConnection ?? legacyConnection;

  if (protectedConnection !== null) {
    if (asyncStorageConnection !== null) {
      await AsyncStorage.removeItem(legacyKey);
    }
    if (protectedConnection === DISCONNECTED) {
      await SecureStore.deleteItemAsync(key);
      return null;
    }
    return protectedConnection;
  }

  if (connectionToMigrate == null) {
    return null;
  }

  await setBlueskyConnection(accountUUID, connectionToMigrate);
  if (asyncStorageConnection !== null) {
    await AsyncStorage.removeItem(legacyKey);
  }
  return connectionToMigrate;
}
