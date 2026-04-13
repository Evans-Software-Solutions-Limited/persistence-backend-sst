// Jest setup file for mobile package
// Runs after test framework is installed but before tests execute

// Silence console warnings in tests unless debugging
if (!process.env.DEBUG_TESTS) {
  jest.spyOn(console, "warn").mockImplementation(() => {});
}
