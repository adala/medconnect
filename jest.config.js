// gateway/jest.config.js

module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/**/*.test.js',
        '!src/**/index.js'
    ],
    coverageThreshold: {
        global: {
            branches: 70,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    verbose: true,
    testTimeout: 10000
};