// Minimal Foundry globals needed at module-evaluation time: ApplicationV2
// subclasses evaluate their `extends` clause on import, before tests can
// stub globals. Individual tests still override `foundry` with vi.stubGlobal.
(globalThis as Record<string, unknown>).foundry ??= {
  applications: { api: { ApplicationV2: class {} } },
};
