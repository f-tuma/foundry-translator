import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { chromium } from "playwright-core";

const foundryUrl = process.env.FOUNDRY_URL ?? "http://127.0.0.1:30000";
const sourceLanguage = process.env.SOURCE_LANGUAGE ?? "en";
const targetLanguage = process.env.TARGET_LANGUAGE ?? "cs";
const sample = process.env.TRANSLATION_SAMPLE ?? "Welcome to the castle.";
const port = Number.parseInt(process.env.CHROMIUM_DEBUG_PORT ?? "9333", 10);
const profile = process.env.CHROMIUM_PROFILE ??
  join(homedir(), ".cache", "foundry-translate", "chromium-diagnostic");
const timeoutMs = Number.parseInt(process.env.DIAGNOSTIC_TIMEOUT_MS ?? "600000", 10);

async function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known executable.
    }
  }
  throw new Error("Chromium/Chrome nebyl nalezen. Nastavte CHROMIUM_PATH.");
}

async function waitForDevtools() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Chromium is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Chromium DevTools endpoint se nespustil do 30 sekund.");
}

const executable = await findChromium();
const args = [
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-sync",
  "--password-store=basic",
  "--enable-logging=stderr",
  "--vmodule=*translate*=3,*component_updater*=2,*on_device*=3",
  "about:blank",
];
const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
const browserLogs = [];
let stderrBuffer = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderrBuffer += chunk;
  const lines = stderrBuffer.split(/\r?\n/u);
  stderrBuffer = lines.pop() ?? "";
  for (const line of lines) {
    if (/translate|component|model|optimization|crash|error/iu.test(line)) {
      browserLogs.push(line);
    }
  }
});

let browser;
let report;
try {
  await waitForDevtools();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();
  const pageLogs = [];
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()) || /translat/iu.test(message.text())) {
      pageLogs.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => pageLogs.push(`pageerror: ${error.message}`));
  await page.goto(foundryUrl, { waitUntil: "domcontentloaded" });

  const support = await page.evaluate(async ({ sourceLanguage, targetLanguage }) => {
    const factory = globalThis.Translator;
    return {
      url: location.href,
      secureContext: isSecureContext,
      userAgent: navigator.userAgent,
      apiPresent: Boolean(factory),
      availability: factory
        ? await factory.availability({ sourceLanguage, targetLanguage })
        : "unavailable",
    };
  }, { sourceLanguage, targetLanguage });

  await page.evaluate(({ sourceLanguage, targetLanguage, sample }) => {
    globalThis.__foundryTranslateDiagnostic = {
      done: false,
      progress: [],
      result: null,
      error: null,
    };
    const button = document.createElement("button");
    button.id = "foundry-translate-diagnostic-trigger";
    button.textContent = "Start Foundry Translate diagnostic";
    button.style.cssText = "position:fixed;z-index:2147483647;top:10px;left:10px";
    button.addEventListener("click", async () => {
      try {
        const translator = await globalThis.Translator.create({
          sourceLanguage,
          targetLanguage,
          monitor(monitor) {
            monitor.addEventListener("downloadprogress", (event) => {
              globalThis.__foundryTranslateDiagnostic.progress.push(event.loaded);
            });
          },
        });
        globalThis.__foundryTranslateDiagnostic.result = await translator.translate(sample);
        translator.destroy?.();
      } catch (error) {
        globalThis.__foundryTranslateDiagnostic.error = {
          name: error?.name,
          message: error?.message,
          stack: error?.stack,
        };
      } finally {
        globalThis.__foundryTranslateDiagnostic.done = true;
      }
    }, { once: true });
    document.body.append(button);
  }, { sourceLanguage, targetLanguage, sample });
  await page.locator("#foundry-translate-diagnostic-trigger").click({ force: true });
  await page.waitForFunction(
    () => globalThis.__foundryTranslateDiagnostic.done,
    null,
    { timeout: timeoutMs },
  );
  const diagnostic = await page.evaluate(() => globalThis.__foundryTranslateDiagnostic);
  report = {
    ok: !diagnostic.error && typeof diagnostic.result === "string" && diagnostic.result.trim() !== "",
    launch: { executable, profile, port },
    languagePair: { sourceLanguage, targetLanguage },
    sample,
    support,
    diagnostic: {
      result: diagnostic.result,
      error: diagnostic.error,
      progressSamples: diagnostic.progress.length,
      firstProgress: diagnostic.progress[0] ?? null,
      lastProgress: diagnostic.progress.at(-1) ?? null,
    },
    pageLogs,
    browserLogs: browserLogs.slice(-200),
  };
} catch (error) {
  report = {
    ok: false,
    launch: { executable, profile, port },
    error: {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    },
    browserLogs: browserLogs.slice(-200),
  };
} finally {
  await browser?.close().catch(() => undefined);
  if (!child.killed) child.kill("SIGTERM");
}

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
