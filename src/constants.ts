export const MODULE_ID = "foundry-translate" as const;
export const MODULE_TITLE = "Foundry Translate" as const;
export const MODULE_VERSION = "0.14.8" as const;

export const MODULE_HOOKS = {
  READY: `${MODULE_ID}.ready`,
} as const;
