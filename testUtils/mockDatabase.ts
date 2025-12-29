import type { SQLiteDatabase } from "expo-sqlite";

export interface MockDatabase {
  execAsync: jest.Mock;
  getAllAsync: jest.Mock;
  getFirstAsync: jest.Mock;
  runAsync: jest.Mock;
  closeAsync: jest.Mock;
  withTransactionAsync: jest.Mock;
}

export function createMockDatabase(
  overrides?: Partial<MockDatabase>
): SQLiteDatabase {
  const mockDb: MockDatabase = {
    execAsync: jest.fn(),
    getAllAsync: jest.fn(() => Promise.resolve([])),
    getFirstAsync: jest.fn(() => Promise.resolve(null)),
    runAsync: jest.fn(() =>
      Promise.resolve({ changes: 0, lastInsertRowId: 0 })
    ),
    closeAsync: jest.fn(() => Promise.resolve()),
    withTransactionAsync: jest.fn((callback) => callback()),
    ...overrides,
  };

  return mockDb as unknown as SQLiteDatabase;
}

export function createMockDatabaseWithData<T>(data: T[]): SQLiteDatabase {
  return createMockDatabase({
    getAllAsync: jest.fn(() => Promise.resolve(data)),
    getFirstAsync: jest.fn(() =>
      Promise.resolve(data.length > 0 ? data[0] : null)
    ),
    runAsync: jest.fn(() =>
      Promise.resolve({ changes: data.length, lastInsertRowId: 1 })
    ),
  });
}
