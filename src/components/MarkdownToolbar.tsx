import { Button } from "@/components/ui/button";
import { Bold, Italic, List, ListOrdered, CheckSquare, Table2, Link as LinkIcon, Code } from "lucide-react";
import React from "react";

interface ToolbarProps {
  value: string;
  onChange: (next: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
}

function applyWrap(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  wrapLeft: string,
  wrapRight: string
) {
  const before = value.slice(0, selectionStart);
  const selected = value.slice(selectionStart, selectionEnd) || "text";
  const after = value.slice(selectionEnd);
  const next = `${before}${wrapLeft}${selected}${wrapRight}${after}`;
  const cursor = before.length + wrapLeft.length + selected.length + wrapRight.length;
  return { next, cursor };
}

function insertBlock(value: string, selectionStart: number, block: string) {
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionStart);
  const next = `${before}${block}${after}`;
  const cursor = before.length + block.length;
  return { next, cursor };
}

export const MarkdownToolbar: React.FC<ToolbarProps> = ({ value, onChange, textareaRef }) => {
  const withSelection = (fn: (start: number, end: number) => void) => {
    const ta = textareaRef?.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? value.length;
    fn(start, end);
    setTimeout(() => {
      if (ta) ta.focus();
    }, 0);
  };

  return (
    <div className="flex flex-wrap gap-1">
      <Button type="button" variant="outline" size="icon"
        title="Bold (Ctrl+B)"
        onClick={() => withSelection((s, e) => {
          const { next, cursor } = applyWrap(value, s, e, "**", "**");
          onChange(next);
          if (textareaRef?.current) textareaRef.current.selectionStart = textareaRef.current.selectionEnd = cursor;
        })}
      >
        <Bold className="h-4 w-4" />
      </Button>
      <Button type="button" variant="outline" size="icon"
        title="Italic (Ctrl+I)"
        onClick={() => withSelection((s, e) => {
          const { next, cursor } = applyWrap(value, s, e, "*", "*");
          onChange(next);
          if (textareaRef?.current) textareaRef.current.selectionStart = textareaRef.current.selectionEnd = cursor;
        })}
      >
        <Italic className="h-4 w-4" />
      </Button>
      <Button type="button" variant="outline" size="icon"
        title="Bulleted list"
        onClick={() => withSelection((s) => {
          const { next, cursor } = insertBlock(value, s, "\n- item 1\n- item 2\n- item 3\n");
          onChange(next);
          if (textareaRef?.current) textareaRef.current.selectionStart = textareaRef.current.selectionEnd = cursor;
        })}
      >
        <List className="h-4 w-4" />
      </Button>
      <Button type="button" variant="outline" size="icon"
        title="Numbered list"
        onClick={() => withSelection((s) => {
          const { next, cursor } = insertBlock(value, s, "\n1. First\n2. Second\n3. Third\n");
          onChange(next);
          if (textareaRef?.current) textareaRef.current.selectionStart = textareaRef.current.selectionEnd = cursor;
        })}
      >
        <ListOrdered className="h-4 w-4" />
      </Button>
      <Button type="button" variant="outline" size="icon"
        title="Todo list"
        onClick={() => withSelection((s) => {
          const { next, cursor } = insertBlock(value, s, "\n- [ ] Task 1\n- [x] Task 2\n");
          onChange(next);
          if (textareaRef?.current) textareaRef.current.selectionStart = textareaRef.current.selectionEnd = cursor;
        })}
      >
        <CheckSquare className="h-4 w-4" />
      </Button>
      <Button type="button" variant="outline" size="icon"
        title="Table"
        onClick={() => withSelection((s) => {
          const table = "\n| Column A | Column B |\n|---|---|\n| A1 | B1 |\n| A2 | B2 |\n";
          const { next, cursor } = insertBlock(value, s, table);
          onChange(next);
          if (textareaRef?.current) textareaRef.current.selectionStart = textareaRef.current.selectionEnd = cursor;
        })}
      >
        <Table2 className="h-4 w-4" />
      </Button>
      <Button type="button" variant="outline" size="icon"
        title="Code"
        onClick={() => withSelection((s, e) => {
          const { next, cursor } = applyWrap(value, s, e, "`", "`");
          onChange(next);
          if (textareaRef?.current) textareaRef.current.selectionStart = textareaRef.current.selectionEnd = cursor;
        })}
      >
        <Code className="h-4 w-4" />
      </Button>
      <Button type="button" variant="outline" size="icon"
        title="Link"
        onClick={() => withSelection((s, e) => {
          const selected = value.slice(s, e) || "title";
          const before = value.slice(0, s);
          const after = value.slice(e);
          const inserted = `${before}[${selected}](https://example.com)${after}`;
          onChange(inserted);
          const cursorPos = before.length + `[${selected}](https://example.com)`.length;
          if (textareaRef?.current) textareaRef.current.selectionStart = textareaRef.current.selectionEnd = cursorPos;
        })}
      >
        <LinkIcon className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default MarkdownToolbar;

