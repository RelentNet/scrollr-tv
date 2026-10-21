import { describe, expect, it } from "vitest";
import { kindOf, minutesOf, nameOf, parseNotes } from "./read";

describe("parseNotes: markdown", () => {
  const md = `# Main Stage

- 11:30 AM Love & Bugs In Another World — Main Stage, until 12:15
- 1:00 PM Dragon Ball Universe — Main Stage, until 1:45
- 10:00 AM Doors | Lobby
Closing remarks: Stage A at 5
`;

  it("the heading names the document; bullets and bare lines are items; the detail splits off", () => {
    const doc = parseNotes("1-main-stage.md", md, "md");
    expect(doc.name).toBe("Main Stage");
    expect(doc.items.map((i) => i.title)).toEqual([
      "10:00 AM Doors",
      "11:30 AM Love & Bugs In Another World",
      "1:00 PM Dragon Ball Universe",
      "Closing remarks",
    ]);
    expect(doc.items[1]).toMatchObject({ detail: "Main Stage, until 12:15", at: "11:30 AM", link: "" });
    expect(doc.items[3]).toMatchObject({ detail: "Stage A at 5", at: null });
  });

  it("times order the day; ids stay the written index, so a reorder changes no id", () => {
    const doc = parseNotes("x", md, "md");
    expect(doc.items.map((i) => i.id)).toEqual(["2", "0", "1", "3"]);
  });

  it("no heading: the caller's name; a heading after the first item does not rename", () => {
    expect(parseNotes("Notes", "- one\n# Later\n- two", "md")).toEqual({
      name: "Notes",
      items: [
        { id: "0", title: "one", detail: "", at: null, link: "" },
        { id: "1", title: "two", detail: "", at: null, link: "" },
      ],
    });
  });

  it("a hyphen inside a word is not a split; a spaced one is; a dash wins over a colon", () => {
    const doc = parseNotes("n", "- K-Pop Bingo - Room B\n- One Piece: Voices of the Grand Line — Main Stage", "md");
    expect(doc.items[0]).toMatchObject({ title: "K-Pop Bingo", detail: "Room B" });
    expect(doc.items[1]).toMatchObject({ title: "One Piece: Voices of the Grand Line", detail: "Main Stage" });
  });
});

describe("parseNotes: json", () => {
  it("an object with items, or a bare array of strings and objects", () => {
    expect(parseNotes("s", `{"name":"Today","items":[{"title":"Standup","at":"09:00","note":"zoom"},{"label":"Dentist","at":"14:30","link":"https://x"}]}`, "json")).toEqual({
      name: "Today",
      items: [
        { id: "0", title: "Standup", detail: "zoom", at: "09:00", link: "" },
        { id: "1", title: "Dentist", detail: "", at: "14:30", link: "https://x" },
      ],
    });
    expect(parseNotes("s", `["9:00 AM Doors — Lobby", {"title": "Lunch"}]`, "json").items.map((i) => i.title)).toEqual(["9:00 AM Doors", "Lunch"]);
  });

  it("broken JSON is one item that says so, not a throw", () => {
    const doc = parseNotes("bad.json", "{not json", "json");
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].title).toMatch(/^bad\.json: /);
  });

  it("sniffs JSON by its first character when no kind is given", () => {
    expect(parseNotes("s", `[{"title":"A"}]`).items[0].title).toBe("A");
    expect(parseNotes("s", `- A`).items[0].title).toBe("A");
  });
});

describe("helpers", () => {
  it("minutesOf reads 12-hour, 24-hour and ISO times; rejects nonsense", () => {
    expect(minutesOf("9:00 AM")).toBe(540);
    expect(minutesOf("12:15 AM")).toBe(15);
    expect(minutesOf("12:30 PM")).toBe(750);
    expect(minutesOf("14:30")).toBe(870);
    expect(minutesOf("2026-10-17T09:05")).toBe(545);
    expect(minutesOf("25:00")).toBeNull();
    expect(minutesOf("soon")).toBeNull();
    expect(minutesOf(null)).toBeNull();
  });

  it("kindOf and nameOf read the URL's file name", () => {
    expect(kindOf("http://h/files/1-main-stage.md")).toBe("md");
    expect(kindOf("http://h/files/sched.JSON?v=2")).toBe("json");
    expect(kindOf("http://h/files/notes")).toBeUndefined();
    expect(nameOf("http://h/files/1-main-stage.md")).toBe("main stage");
    expect(nameOf("http://h/files/K-Pop%20Room.txt")).toBe("K Pop Room");
    expect(nameOf("http://h/")).toBe("Notes");
  });
});
