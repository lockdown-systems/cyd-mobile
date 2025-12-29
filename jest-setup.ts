// Jest setup file for mocking React Native and Expo modules
// This enables testing components in a Node.js environment

// Mock React Native entirely with proper functional components
jest.mock("react-native", () => {
  const React = require("react");

  // Create proper functional component mocks for React Native primitives
  const createMockComponent = (name: string) => {
    const Component = React.forwardRef(
      ({ children, ...props }: any, ref: any) =>
        React.createElement(name, { ...props, ref }, children)
    );
    Component.displayName = name;
    return Component;
  };

  return {
    StyleSheet: {
      create: (styles: any) => styles,
      hairlineWidth: 1,
    },
    View: createMockComponent("View"),
    Text: createMockComponent("Text"),
    Dimensions: {
      get: jest.fn(() => ({ height: 800, width: 400 })),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
    Platform: {
      OS: "ios",
      select: (obj: any) => obj.ios || obj.default,
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

// Mock expo-sqlite
jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(() =>
    Promise.resolve({
      execAsync: jest.fn(() => Promise.resolve()),
      getAllAsync: jest.fn(() => Promise.resolve([])),
      getFirstAsync: jest.fn(() => Promise.resolve(null)),
      runAsync: jest.fn(() =>
        Promise.resolve({ changes: 0, lastInsertRowId: 0 })
      ),
      closeAsync: jest.fn(() => Promise.resolve()),
      withTransactionAsync: jest.fn((callback) => callback()),
    })
  ),
}));

// Mock expo-file-system
jest.mock("expo-file-system", () => ({
  documentDirectory: "/mock/document/directory/",
  cacheDirectory: "/mock/cache/directory/",
  makeDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(),
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false })),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
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

// Silence console warnings in tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};
