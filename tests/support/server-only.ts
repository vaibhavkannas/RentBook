// Stands in for the "server-only" package in tests (see vitest.config.mts). The real one throws when it is
// imported outside a Next server build; the tests run the server code on purpose, so they get this empty module.
export {};
