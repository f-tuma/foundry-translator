import { GlossaryIntegrityError } from "../glossary/protection";

const FOUNDRY_EXPRESSION =
  /@[A-Za-z][A-Za-z0-9]*\[[^\]\r\n]*\](?:\{[^}\r\n]*\})?|\[\[[^\]\r\n]*\]\]/gu;
const EMBED_EXPRESSION =
  /^@Embed\[(?<config>[^\]\r\n]*)\](?:\{(?<label>[^}\r\n]*)\})?$/iu;
const TRANSLATABLE_EMBED_OPTION =
  /\b(?:readaloud|caption|label)="(?<value>[^"]*)"/giu;

export interface FoundrySyntaxToken {
  token: string;
  source: string;
}

export interface FoundrySyntaxProtection {
  text: string;
  nonce: string;
  tokens: readonly FoundrySyntaxToken[];
}

export interface ProtectFoundrySyntaxOptions {
  nonce?: string;
}

function createNonce(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

function assertNonce(nonce: string): void {
  if (!/^[A-Za-z0-9]+$/u.test(nonce)) {
    throw new TypeError("Foundry syntax token nonce may contain only ASCII letters and digits.");
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenPattern(token: string): RegExp {
  return new RegExp(escapeRegExp(token), "giu");
}

function syntaxTokenPattern(nonce: string): RegExp {
  return new RegExp(`__FTS_${escapeRegExp(nonce)}_[A-Z0-9]+__`, "giu");
}

function protectEmbed(
  expression: string,
  addToken: (source: string) => string,
): string {
  const match = EMBED_EXPRESSION.exec(expression);
  if (!match?.groups) return addToken(expression);

  const config = match.groups.config ?? "";
  const prefix = addToken("@Embed[");
  const output: string[] = [];
  let cursor = 0;
  for (const option of config.matchAll(TRANSLATABLE_EMBED_OPTION)) {
    const value = option.groups?.value ?? "";
    if (!/[\p{L}\p{N}]/u.test(value)) continue;
    const optionStart = option.index;
    const valueStart = optionStart + option[0].lastIndexOf(value);
    const valueEnd = valueStart + value.length;
    output.push(addToken(config.slice(cursor, valueStart)), value);
    cursor = valueEnd;
  }
  output.push(addToken(config.slice(cursor)));

  const protectedExpression = [prefix, ...output, addToken("]")];
  const label = match.groups.label;
  if (label !== undefined) {
    protectedExpression.push(addToken("{"), label, addToken("}"));
  }
  return protectedExpression.join("");
}

function protectExpression(
  expression: string,
  addToken: (source: string) => string,
): string {
  if (/^@Embed\[/iu.test(expression)) return protectEmbed(expression, addToken);

  const labelStart = expression.lastIndexOf("{");
  if (labelStart > expression.lastIndexOf("]") && expression.endsWith("}")) {
    return [
      addToken(expression.slice(0, labelStart)),
      addToken("{"),
      expression.slice(labelStart + 1, -1),
      addToken("}"),
    ].join("");
  }
  return addToken(expression);
}

export function protectFoundrySyntax(
  text: string,
  options: ProtectFoundrySyntaxOptions = {},
): FoundrySyntaxProtection {
  const nonce = (options.nonce ?? createNonce()).toUpperCase();
  assertNonce(nonce);
  const tokens: FoundrySyntaxToken[] = [];
  const addToken = (source: string): string => {
    if (!source) return "";
    const token = `__FTS_${nonce}_${tokens.length.toString(36).toUpperCase().padStart(4, "0")}__`;
    tokens.push({ token, source });
    return token;
  };

  return {
    text: text.replace(FOUNDRY_EXPRESSION, (expression) =>
      protectExpression(expression, addToken)),
    nonce,
    tokens,
  };
}

export function restoreFoundrySyntax(
  translatedText: string,
  protection: FoundrySyntaxProtection,
): string {
  const knownTokens = new Set(protection.tokens.map(({ token }) => token.toUpperCase()));
  for (const found of translatedText.matchAll(syntaxTokenPattern(protection.nonce))) {
    if (!knownTokens.has(found[0].toUpperCase())) {
      throw new GlossaryIntegrityError(
        `Translation returned an unknown Foundry syntax token: ${found[0]}`,
      );
    }
  }

  let restored = translatedText;
  let previousPosition = -1;
  for (const { token, source } of protection.tokens) {
    const pattern = tokenPattern(token);
    const matches = [...restored.matchAll(pattern)];
    if (matches.length !== 1) {
      throw new GlossaryIntegrityError(
        `Translation must contain Foundry syntax token ${token} exactly once; found ${matches.length}.`,
      );
    }
    const position = matches[0]?.index ?? -1;
    if (position < previousPosition) {
      throw new GlossaryIntegrityError("Translation changed the order of Foundry syntax tokens.");
    }
    previousPosition = position;
    restored = restored.replace(tokenPattern(token), () => source);
  }
  return restored;
}
