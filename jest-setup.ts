// Jest setup file for mocking React Native and Expo modules
// This enables testing components in a Node.js environment

import React, { type ReactNode } from "react";

// Expo/React Native global flag

(global as unknown as { __DEV__: boolean }).__DEV__ = false;

type MockProps = Record<string, unknown> & { children?: ReactNode };
type PlatformSelectOptions<T> = Partial<Record<string, T>> & { default?: T };

const createMockComponent = (name: string) => {
  const Component = React.forwardRef<unknown, MockProps>(
    ({ children, ...props }, ref) =>
      React.createElement(name, { ...props, ref }, children as ReactNode),
  );
  Component.displayName = name;
  return Component;
};

// Mock React Native entirely with proper functional components
jest.mock("react-native", () => {
  return {
    StyleSheet: {
      create: <T extends Record<string, unknown>>(styles: T): T => styles,
      flatten: (
        style:
          | Record<string, unknown>
          | Record<string, unknown>[]
          | null
          | undefined,
      ): Record<string, unknown> => {
        if (!style) return {};
        if (Array.isArray(style)) {
          return style.reduce<Record<string, unknown>>(
            (acc, s) => ({ ...acc, ...(s || {}) }),
            {},
          );
        }
        return style;
      },
      hairlineWidth: 1,
    },
    View: createMockComponent("View"),
    Text: createMockComponent("Text"),
    Image: createMockComponent("Image"),
    Pressable: createMockComponent("Pressable"),
    TouchableOpacity: createMockComponent("TouchableOpacity"),
    FlatList: createMockComponent("FlatList"),
    Modal: createMockComponent("Modal"),
    TextInput: createMockComponent("TextInput"),
    ActivityIndicator: createMockComponent("ActivityIndicator"),
    ScrollView: createMockComponent("ScrollView"),
    KeyboardAvoidingView: createMockComponent("KeyboardAvoidingView"),
    Switch: createMockComponent("Switch"),
    Linking: {
      openURL: jest.fn().mockResolvedValue(true),
      canOpenURL: jest.fn().mockResolvedValue(true),
    },
    Alert: {
      alert: jest.fn(),
    },
    Dimensions: {
      get: jest.fn(() => ({ height: 800, width: 400 })),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
    Platform: {
      OS: "ios",
      select: <T>(options: PlatformSelectOptions<T>): T | undefined =>
        options.ios ?? options.native ?? options.default,
    },
    Animated: {
      Value: jest.fn(() => ({
        setValue: jest.fn(),
        interpolate: jest.fn(() => ({ interpolate: jest.fn() })),
      })),
      timing: jest.fn(() => ({ start: jest.fn() })),
      spring: jest.fn(() => ({ start: jest.fn() })),
      View: createMockComponent("Animated.View"),
    },
  };
});

// Mock expo-router
jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
  })),
  useLocalSearchParams: jest.fn(() => ({})),
  usePathname: jest.fn(() => "/"),
  useSegments: jest.fn(() => []),
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
  },
  Link: "Link",
  Stack: "Stack",
}));

jest.mock("react-native-safe-area-context", () => {
  const React = require("react");
  return {
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("SafeAreaProvider", null, children),
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("SafeAreaView", null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    initialWindowMetrics: {
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      frame: { x: 0, y: 0, width: 0, height: 0 },
    },
  };
});

// Mock expo-sqlite
jest.mock("expo-sqlite", () => ({
  defaultDatabaseDirectory: "/mock/files/SQLite",
  openDatabaseAsync: jest.fn(() =>
    Promise.resolve({
      execAsync: jest.fn(() => Promise.resolve()),
      getAllAsync: jest.fn(() => Promise.resolve([])),
      getFirstAsync: jest.fn(() => Promise.resolve(null)),
      runAsync: jest.fn(() =>
        Promise.resolve({ changes: 0, lastInsertRowId: 0 }),
      ),
      closeAsync: jest.fn(() => Promise.resolve()),
      withTransactionAsync: jest.fn(
        async (callback: () => Promise<void>) => await callback(),
      ),
    }),
  ),
}));

// Mock expo-crypto
jest.mock("expo-crypto", () => {
  let counter = 0;
  const nextUuid = () => `mocked-uuid-${counter++}`;
  return {
    randomUUID: jest.fn(() => nextUuid()),
    randomUUIDAsync: jest.fn(() => Promise.resolve(nextUuid())),
  };
});

// Mock expo-file-system
jest.mock("expo-file-system", () => {
  const fileContents = new Map<string, string>();

  const joinUri = (uris: (string | { uri: string })[]): string =>
    uris
      .map((u) => (typeof u === "string" ? u : u.uri))
      .filter((part) => part.length > 0)
      .reduce((acc, part, index) => {
        if (index === 0) return part;
        if (!acc.endsWith("/") && !part.startsWith("/")) {
          return `${acc}/${part}`;
        }
        if (acc.endsWith("/") && part.startsWith("/")) {
          return `${acc}${part.slice(1)}`;
        }
        return `${acc}${part}`;
      }, "");

  class Directory {
    uri: string;
    exists: boolean;
    name: string;

    constructor(...uris: (string | { uri: string })[]) {
      const joined = joinUri(uris);
      this.uri = joined.endsWith("/") ? joined : `${joined}/`;
      this.exists = true;
      this.name = this.uri.split("/").filter(Boolean).pop() ?? "";
    }

    create = jest.fn(() => {
      this.exists = true;
    });

    delete = jest.fn();

    list = jest.fn(() => []);
  }

  class File {
    uri: string;
    exists: boolean;
    name: string;

    constructor(...uris: (string | { uri: string })[]) {
      this.uri = joinUri(uris);
      this.exists = true;
      this.name = this.uri.split("/").pop() ?? "";
    }

    write = jest.fn((content: string) => {
      fileContents.set(this.uri, content);
    });

    text = jest.fn(() => fileContents.get(this.uri) ?? "");

    copy = jest.fn();

    delete = jest.fn();

    static downloadFileAsync = jest.fn(
      async (_url: string, to: { uri: string }) => {
        return { uri: to.uri };
      },
    );
  }

  const Paths = {
    document: { uri: "file:///mock/document/directory/" },
    cache: { uri: "file:///mock/cache/directory/" },
    info: jest.fn(() => ({ exists: false, isDirectory: false })),
  };

  const downloadAsync = jest.fn((url: string, fileUri: string) =>
    Promise.resolve({ uri: fileUri, url }),
  );
  const getInfoAsync = jest.fn(() =>
    Promise.resolve({ exists: false, uri: "" }),
  );

  return {
    documentDirectory: "/mock/document/directory/",
    cacheDirectory: "/mock/cache/directory/",
    Directory,
    File,
    Paths,
    makeDirectoryAsync: jest.fn(),
    deleteAsync: jest.fn(),
    getInfoAsync,
    downloadAsync,
    readAsStringAsync: jest.fn(),
    writeAsStringAsync: jest.fn(),
    __mockState: { fileContents },
  };
});

// Mock expo-file-system legacy entrypoint
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/mock/document/directory/",
  cacheDirectory: "/mock/cache/directory/",
}));

// Mock react-native-quick-crypto to avoid native module requirements in Jest
jest.mock("react-native-quick-crypto", () => ({
  install: jest.fn(),
}));

// Mock expo-web-browser
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn(async () => ({
    type: "success",
    url: "https://example.com/callback?code=mock",
  })),
  WebBrowserResultType: {
    SUCCESS: "success",
    CANCEL: "cancel",
    DISMISS: "dismiss",
  },
  maybeCompleteAuthSession: jest.fn(),
}));

// Mock react-native-svg
jest.mock("react-native-svg", () => ({
  Svg: "Svg",
  Circle: "Circle",
  Path: "Path",
  G: "G",
  Defs: "Defs",
  LinearGradient: "LinearGradient",
  Stop: "Stop",
}));

// Mock expo-sharing
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

// Mock react-native-zip-archive
jest.mock("react-native-zip-archive", () => ({
  zip: jest.fn((source: string, target: string) => Promise.resolve(target)),
  unzip: jest.fn((source: string, target: string) => Promise.resolve(target)),
}));

// Silence console warnings in tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};
