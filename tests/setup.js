// gateway/tests/setup.js

// Increase timeout for async tests
jest.setTimeout(30000);

// Suppress console logs during tests
global.console = {
    ...console,
    log: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
};

// Mock environment variables
process.env.TENANT_ID = 'test-tenant';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-long!!';