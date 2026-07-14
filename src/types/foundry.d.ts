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
  actors: { contents: FoundryNamedDocument[] };
  scenes: { contents: FoundryNamedDocument[] };
  journal: { contents: FoundryJournalWorldDocument[] };
  folders: { contents: FoundryFolder[] };
  packs: Map<string, FoundryCompendiumCollection>;
  user?: { isGM: boolean };
}

interface FoundryNamedDocument {
  name?: string | null;
  uuid?: string;
}

interface FoundryCompendiumIndexEntry {
  _id: string;
  name?: string;
  flags?: Record<string, Record<string, unknown>>;
}

interface FoundryCompendiumCollection {
  collection: string;
  locked: boolean;
  folder: FoundryFolder | null;
  getIndex(options?: { fields?: string[] }): Promise<Map<string, FoundryCompendiumIndexEntry>>;
  getDocument(id: string): Promise<FoundryJournalDocument | undefined>;
  render(options?: boolean | Record<string, unknown>): unknown;
  setFolder(folder: string | FoundryFolder | null): Promise<void>;
}

interface FoundryFolder {
  id: string | null;
  name: string;
  type: string;
  flags?: Record<string, Record<string, unknown>>;
}

interface FoundryFolderData {
  name: string;
  type: "Compendium";
  color: string;
  sorting: "a" | "m";
  flags: Record<string, Record<string, unknown>>;
}

interface FoundryJournalEntryData {
  [key: string]: unknown;
  _id?: string;
  name: string;
  flags?: Record<string, Record<string, unknown>>;
}

interface FoundryJournalDocument {
  id: string | null;
  name?: string;
  uuid?: string;
  documentName?: string;
  parent?: FoundryUuidDocument | null;
  flags?: Record<string, Record<string, unknown>>;
  toObject(): Record<string, unknown>;
  sheet?: { render(options?: boolean | Record<string, unknown>): unknown };
}

interface FoundryUuidDocument {
  id: string | null;
  uuid: string;
  documentName?: string;
  parent?: FoundryUuidDocument | null;
  flags?: Record<string, Record<string, unknown>>;
  toObject?(): Record<string, unknown>;
}

interface FoundryJournalWorldDocument extends FoundryJournalDocument {
  name: string;
  uuid: string;
  toObject(): Record<string, unknown>;
  sheet?: { render(options?: boolean | Record<string, unknown>): unknown };
}

interface FoundryRuntimeSystem {
  constructor?: {
    schema?: { fields?: Record<string, unknown> };
  };
}

interface FoundryActorDocument extends FoundryUuidDocument {
  id: string | null;
  uuid: string;
  documentName?: "Actor";
  name?: string;
  type?: string;
  system?: FoundryRuntimeSystem;
  items?: { contents?: FoundryItemDocument[] };
  flags?: Record<string, Record<string, unknown>>;
  toObject(): Record<string, unknown>;
  sheet?: { render(options?: boolean | Record<string, unknown>): unknown };
}

interface FoundryActorWorldDocument extends FoundryActorDocument {
  name: string;
  type: string;
}

interface FoundryItemDocument extends FoundryUuidDocument {
  id: string | null;
  name?: string;
  system?: FoundryRuntimeSystem;
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
  documents: {
    Folder: {
      implementation: {
        create(data: FoundryFolderData): Promise<FoundryFolder | FoundryFolder[] | undefined>;
      };
    };
    JournalEntry: {
      implementation: {
        create(data: Record<string, unknown>): Promise<FoundryJournalWorldDocument | undefined>;
        createDocuments(
          data: FoundryJournalEntryData[],
          operation: { pack: string },
        ): Promise<FoundryJournalDocument[]>;
        updateDocuments(
          data: FoundryJournalEntryData[],
          operation: { pack: string },
        ): Promise<unknown[]>;
      };
    };
    Actor: {
      implementation: {
        createDocuments(
          data: Record<string, unknown>[],
          operation: { pack: string; keepId?: boolean },
        ): Promise<FoundryActorDocument[]>;
        updateDocuments(
          data: Record<string, unknown>[],
          operation: { pack: string },
        ): Promise<unknown[]>;
      };
    };
    collections: {
      CompendiumCollection: {
        createCompendium(
          metadata: Record<string, unknown>,
          options?: Record<string, unknown>,
        ): Promise<FoundryCompendiumCollection>;
      };
    };
  };
};

declare const ui: {
  notifications: {
    info(message: string, options?: { localize?: boolean; permanent?: boolean }): unknown;
    success(message: string, options?: { localize?: boolean }): unknown;
    warn(message: string, options?: { localize?: boolean; permanent?: boolean }): unknown;
    error(message: string, options?: { localize?: boolean; permanent?: boolean }): unknown;
  };
};

interface FoundryHooks {
  on(hook: string, callback: (...args: any[]) => void): number;
  once(hook: string, callback: (...args: unknown[]) => void): number;
  callAll(hook: string, ...args: unknown[]): boolean;
}

declare const game: FoundryGame;
declare const Hooks: FoundryHooks;
declare function fromUuid(
  uuid: string,
  options?: { relative?: FoundryUuidDocument; invalid?: boolean },
): Promise<FoundryUuidDocument | null>;
