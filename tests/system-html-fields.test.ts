import { describe, expect, it } from "vitest";

import {
  discoverSystemHtmlFieldPaths,
  readPath,
  writePath,
} from "../src/translation/system-html-fields";

class HTMLField {}

class StringField {}

class SchemaField {
  constructor(readonly fields: Record<string, unknown>) {}
}

class ArrayField {
  constructor(readonly element: unknown) {}
}

describe("custom system HTML fields", () => {
  it("discovers concrete HTML paths through schemas and arrays", () => {
    const fields = {
      content: new SchemaField({
        overview: new HTMLField(),
        identifier: new StringField(),
      }),
      outcomes: new ArrayField(new SchemaField({ summary: new HTMLField() })),
    };
    const system = {
      content: { overview: "<p>Player text</p>", identifier: "do-not-translate" },
      outcomes: [{ summary: "<p>First</p>" }, { summary: "<p>Second</p>" }],
    };

    expect(discoverSystemHtmlFieldPaths(fields, system)).toEqual([
      ["content", "overview"],
      ["outcomes", 0, "summary"],
      ["outcomes", 1, "summary"],
    ]);
  });

  it("reads and writes only the requested concrete path", () => {
    const system = { content: { overview: "Original", identifier: "keep" } };
    const path = ["content", "overview"] as const;

    expect(readPath(system, path)).toBe("Original");
    expect(writePath(system, path, "Překlad")).toBe(true);
    expect(system).toEqual({ content: { overview: "Překlad", identifier: "keep" } });
  });
});
