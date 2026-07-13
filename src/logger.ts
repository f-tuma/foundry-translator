import { MODULE_TITLE } from "./constants";

type LogMethod = "debug" | "info" | "warn" | "error";

function write(method: LogMethod, message: string, ...details: unknown[]): void {
  console[method](`${MODULE_TITLE} | ${message}`, ...details);
}

export const logger = {
  debug: (message: string, ...details: unknown[]) => write("debug", message, ...details),
  info: (message: string, ...details: unknown[]) => write("info", message, ...details),
  warn: (message: string, ...details: unknown[]) => write("warn", message, ...details),
  error: (message: string, ...details: unknown[]) => write("error", message, ...details),
};
