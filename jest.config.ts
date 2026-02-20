import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Set up environment variables for tests
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  // Clear mocks between tests
  clearMocks: true,
  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/__tests__/**',
    '!src/types/**',
    '!src/index.ts',
  ],
};

export default config;
