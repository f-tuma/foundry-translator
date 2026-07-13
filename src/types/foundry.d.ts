interface FoundryModuleRecord {
  api?: unknown;
  active?: boolean;
  version?: string;
}

interface FoundryGame {
  modules: Map<string, FoundryModuleRecord>;
  i18n: {
    localize(key: string): string;
  };
  settings: {
    register(namespace: string, key: string, config: FoundrySettingConfig): void;
    registerMenu(namespace: string, key: string, config: FoundrySettingMenuConfig): void;
    get(namespace: string, key: string): unknown;
    set(namespace: string, key: string, value: unknown): Promise<unknown>;
  };
}

interface FoundrySettingConfig {
  name: string;
  hint: string;
  scope: "client" | "world" | "user";
  config: boolean;
  type: StringConstructor | NumberConstructor | BooleanConstructor | ObjectConstructor;
  default: unknown;
}

interface FoundrySettingMenuConfig {
  name: string;
  label: string;
  hint: string;
  icon: string;
  type: new (...args: never[]) => unknown;
  restricted: boolean;
}

declare class FoundryApplicationV2 {
  static DEFAULT_OPTIONS: Record<string, unknown>;
  readonly element: HTMLElement;
  render(options?: boolean | Record<string, unknown>): Promise<FoundryApplicationV2>;
  close(options?: Record<string, unknown>): Promise<FoundryApplicationV2>;
}

declare const foundry: {
  applications: {
    api: {
      ApplicationV2: typeof FoundryApplicationV2;
    };
  };
  utils: {
    fetchWithTimeout(
      url: string,
      data?: RequestInit,
      options?: { timeoutMs?: number | null; onTimeout?: () => void },
    ): Promise<Response>;
  };
};

declare const ui: {
  notifications: {
    success(message: string, options?: { localize?: boolean }): unknown;
    error(message: string, options?: { localize?: boolean; permanent?: boolean }): unknown;
  };
};

interface FoundryHooks {
  once(hook: string, callback: (...args: unknown[]) => void): number;
  callAll(hook: string, ...args: unknown[]): boolean;
}

declare const game: FoundryGame;
declare const Hooks: FoundryHooks;
