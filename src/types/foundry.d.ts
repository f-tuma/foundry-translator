interface FoundryModuleRecord {
  api?: unknown;
}

interface FoundryGame {
  modules: Map<string, FoundryModuleRecord>;
}

interface FoundryHooks {
  once(hook: string, callback: (...args: unknown[]) => void): number;
  callAll(hook: string, ...args: unknown[]): boolean;
}

declare const game: FoundryGame;
declare const Hooks: FoundryHooks;
