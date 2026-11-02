// describe, test, expect and the hooks are globals in the test files, as
// `bun test` defines them. A move to Vitest only changes this line (its
// `globals: true` and `vitest/globals`), not every test file.
/// <reference types="bun-types/test-globals" />
