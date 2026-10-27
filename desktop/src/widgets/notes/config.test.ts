import { describe, expect, it } from "vitest";
import { MAX_SOURCES, migrateNotes } from "./config";

describe("migrateNotes", () => {
  it("nothing stored, or junk: no sources", () => {
    expect(migrateNotes(undefined)).toEqual({ sources: [] });
    expect(migrateNotes({ sources: "x" })).toEqual({ sources: [] });
  });

  it("URLs and rows, trimmed, deduplicated, non-URLs dropped, names kept when given", () => {
    expect(
      migrateNotes({
        sources: [" https://h/a.md ", { url: "https://h/a.md", name: "A" }, { url: "https://h/b.json", name: "  " }, { url: "c:/local.md" }, 7],
      }),
    ).toEqual({ sources: [{ url: "https://h/a.md" }, { url: "https://h/b.json" }] });
    expect(migrateNotes([{ url: "http://h/x.md", name: "X" }])).toEqual({ sources: [{ url: "http://h/x.md", name: "X" }] });
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_SOURCES + 3 }, (_, i) => `https://h/${i}.md`);
    expect(migrateNotes(many).sources).toHaveLength(MAX_SOURCES);
  });
});
