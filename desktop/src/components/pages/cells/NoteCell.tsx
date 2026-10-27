import { memo } from "react";
import type { NoteChipData } from "../../../types";

/** Narrowest column a note takes (a kicker, a whole short title, a readable detail), for pagePlan's `columnsFor`. */
export const NOTE_MIN_COL = 300;

interface NoteCellProps {
  item: NoteChipData;
  onClick?: () => void;
}

/**
 * One item of a Notes document on its page (docs/SCROLLR_TV.md). Three
 * lines, three sizes (§P.9): the kicker, 11px mono, the document's name in
 * the ink with the item's time right-aligned in `fg-3`; the title, 14px
 * semibold; the detail, 12px `fg-3`, mounted blank when the file gave none
 * so a page's rows never shift. Everything truncates in its frozen column
 * (§P.8). Click: the item's link, if it has one.
 */
const NoteCell = memo(function NoteCell({ item, onClick }: NoteCellProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={item.id}
      className="relative flex h-full w-full min-w-0 flex-col justify-center gap-[3px] pl-[18px] pr-4 text-left"
    >
      <span className="flex min-w-0 items-center gap-2 font-mono text-[11px] leading-[15px]">
        <span data-part="doc" className="min-w-0 truncate font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--accent-ink)" }}>
          {item.doc}
        </span>
        <span data-part="at" className="ml-auto shrink-0 text-[12px] font-semibold tabular-nums text-fg-3">
          {item.at}
        </span>
      </span>
      <span data-part="title" className="truncate font-sans text-[14px] font-semibold leading-[18px] text-fg">
        {item.title}
      </span>
      <span data-part="detail" className="truncate font-sans text-[12px] leading-[15px] text-fg-3">
        {item.detail || " "}
      </span>
    </button>
  );
});

export default NoteCell;
