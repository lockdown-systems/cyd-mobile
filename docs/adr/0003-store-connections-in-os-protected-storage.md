# Store connections in OS-protected storage

Cyd Mobile stores Bluesky OAuth session material outside account databases and archives in iOS Keychain or Android Keystore-backed secure storage, keyed by local-account UUID. Existing session material in `AsyncStorage` is moved and its old copy removed only after the protected write succeeds; disconnecting removes the protected connection while retaining the local account and its saved data.
