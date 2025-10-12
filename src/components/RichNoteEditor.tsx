import React, { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Button } from "@/components/ui/button";
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, CheckSquare, Table2, Link as LinkIcon, Heading1, Heading2, Heading3, Undo2, Redo2, Rows, Columns, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { transformMarkdownToHtml } from "@/components/MarkdownRenderer";

function isLikelyHtml(s: string) {
  return /<\w+[\s\S]*>/m.test(s);
}

interface RichNoteEditorProps {
  value: string;
  onChange: (nextHtml: string) => void;
  placeholder?: string;
}

export const RichNoteEditor: React.FC<RichNoteEditorProps> = ({ value, onChange, placeholder }) => {
  const initialHtml = isLikelyHtml(value) ? value : transformMarkdownToHtml(value || "");

  const extensions = useMemo(() => {
    const raw = [
      StarterKit.configure({ codeBlock: true }),
      Placeholder.configure({ placeholder: placeholder || "Write your note..." }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ];
    // Deduplicate by extension name to avoid TipTap duplicate warnings,
    // and keep a stable array identity across renders.
    const seen = new Set<string>();
    const unique = [] as any[];
    for (const ext of raw) {
      const name = (ext as any)?.name;
      if (!name || !seen.has(name)) {
        unique.push(ext);
        if (name) seen.add(name);
      }
    }
    return unique as any;
  }, [placeholder]);

  const initialUpdateSkipped = useRef(false);
  const editor = useEditor({
    extensions,
    content: initialHtml || "",
    onUpdate: ({ editor }) => {
      // Skip the very first update after mount to avoid
      // marking the note as changed when TipTap normalizes content.
      if (!initialUpdateSkipped.current) {
        initialUpdateSkipped.current = true;
        return;
      }
      const html = editor.getHTML();
      onChange(html);
    },
  });

  // Link dialog state
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  useEffect(() => {
    if (!editor) return;
    const next = isLikelyHtml(value) ? value : transformMarkdownToHtml(value || "");
    // Only update if content actually differs to avoid loop
    if (editor.getHTML() !== next) {
      editor.commands.setContent(next, false);
    }
  }, [value, editor]);

  // Keyboard shortcut Ctrl+H to open link dialog
  useEffect(() => {
    if (!editor) return;
    const el = editor.view.dom as HTMLElement;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        const { from, to } = editor.state.selection;
        const selected = from !== to ? editor.state.doc.textBetween(from, to, " ") : "";
        setLinkText(selected);
        setLinkUrl("");
        setLinkOpen(true);
      }
    };
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('keydown', onKey); };
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="border border-border rounded-md">
      {/* Sticky toolbar: stays visible while the note scrolls */}
      <div className="sticky top-0 z-20 flex flex-wrap gap-1 p-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <Button type="button" variant="outline" size="icon" onClick={() => editor.chain().focus().undo().run()} aria-label="Undo">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={() => editor.chain().focus().redo().run()} aria-label="Redo">
          <Redo2 className="h-4 w-4" />
        </Button>

        {/* Headings */}
        <Button type="button" variant={editor.isActive('heading', { level: 1 }) ? 'default' : 'outline'} size="icon" onClick={() => {
          // Apply heading to current block or selection (Word-like)
          editor.chain().focus().toggleHeading({ level: 1 }).run();
        }} aria-label="Heading 1">
          <Heading1 className="h-4 w-4" />
        </Button>
        <Button type="button" variant={editor.isActive('heading', { level: 2 }) ? 'default' : 'outline'} size="icon" onClick={() => {
          editor.chain().focus().toggleHeading({ level: 2 }).run();
        }} aria-label="Heading 2">
          <Heading2 className="h-4 w-4" />
        </Button>
        <Button type="button" variant={editor.isActive('heading', { level: 3 }) ? 'default' : 'outline'} size="icon" onClick={() => {
          editor.chain().focus().toggleHeading({ level: 3 }).run();
        }} aria-label="Heading 3">
          <Heading3 className="h-4 w-4" />
        </Button>
        <Button type="button" variant={editor.isActive('bold') ? 'default' : 'outline'} size="icon" onClick={() => {
          // Toggle bold for selection or next input if no selection
          editor.chain().focus().toggleBold().run();
        }} aria-label="Bold">
          <Bold className="h-4 w-4" />
        </Button>
        <Button type="button" variant={editor.isActive('italic') ? 'default' : 'outline'} size="icon" onClick={() => {
          editor.chain().focus().toggleItalic().run();
        }} aria-label="Italic">
          <Italic className="h-4 w-4" />
        </Button>
        <Button type="button" variant={editor.isActive('underline') ? 'default' : 'outline'} size="icon" onClick={() => {
          editor.chain().focus().toggleUnderline().run();
        }} aria-label="Underline">
          <UnderlineIcon className="h-4 w-4" />
        </Button>
        <Button type="button" variant={editor.isActive('bulletList') ? 'default' : 'outline'} size="icon" onClick={() => {
          // Toggle list at cursor/selection like Word
          editor.chain().focus().toggleBulletList().run();
        }} aria-label="Bulleted list">
          <List className="h-4 w-4" />
        </Button>
        <Button type="button" variant={editor.isActive('orderedList') ? 'default' : 'outline'} size="icon" onClick={() => {
          editor.chain().focus().toggleOrderedList().run();
        }} aria-label="Numbered list">
          <ListOrdered className="h-4 w-4" />
        </Button>
        <Button type="button" variant={editor.isActive('taskList') ? 'default' : 'outline'} size="icon" onClick={() => {
          editor.chain().focus().toggleTaskList().run();
        }} aria-label="Todo list">
          <CheckSquare className="h-4 w-4" />
        </Button>
        {/* Removed duplicate list dropdown to keep a single tool */}

        {/* Removed explicit "+" add button for checklist per request */}

        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label="Table">
              <Table2 className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto">
            <TableSizePicker onPick={(r, c) => editor.chain().focus().insertTable({ rows: r, cols: c, withHeaderRow: true }).run()} />
            <div className="mt-2 flex flex-wrap gap-1">
              <Button type="button" variant="outline" size="sm" onClick={() => editor.chain().focus().addRowAfter().run()}><Rows className="h-4 w-4 mr-1"/>Row+</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns className="h-4 w-4 mr-1"/>Col+</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => editor.chain().focus().deleteRow().run()}><Rows className="h-4 w-4 mr-1"/>Del Row</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => editor.chain().focus().deleteColumn().run()}><Columns className="h-4 w-4 mr-1"/>Del Col</Button>
              <Button type="button" variant="destructive" size="sm" onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 className="h-4 w-4 mr-1"/>Del</Button>
            </div>
          </PopoverContent>
        </Popover>
        {/* Removed inline code (markdown) button per request */}
        <Button
          type="button"
          variant={editor.isActive('link') ? 'default' : 'outline'}
          size="icon"
          aria-label="Link"
          onClick={() => {
            const { from, to } = editor.state.selection;
            const selected = from !== to ? editor.state.doc.textBetween(from, to, " ") : "";
            setLinkText(selected);
            setLinkUrl("");
            setLinkOpen(true);
          }}
        >
          <LinkIcon className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-[300px] p-3 prose prose-sm max-w-none bg-background">
        <EditorContent editor={editor} />
      </div>

      {/* Link Dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md" aria-describedby="link-dialog-description">
          <DialogHeader>
            <DialogTitle>Add Hyperlink</DialogTitle>
            <DialogDescription id="link-dialog-description" className="sr-only">
              Enter the link text and destination URL, then insert it into your note.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-sm">Text to display</label>
              <Input value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="Example" />
            </div>
            <div className="grid gap-1">
              <label className="text-sm">Address</label>
              <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                try {
                  const u = new URL(linkUrl);
                  if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
                } catch { return; }
                const { from, to } = editor!.state.selection;
                const hasSel = from !== to;
                const display = (linkText || linkUrl).trim();
                if (!display) return;
                if (hasSel) {
                  // apply link mark to selection
                  // @ts-expect-error mark may not exist if Link missing
                  editor!.chain().focus().setLink?.({ href: linkUrl.trim() }).run?.();
                } else {
                  // insert linked text
                  editor!.chain().focus().insertContent(`<a href="${linkUrl.trim()}" target="_blank" rel="noopener noreferrer">${display}</a>`).run();
                }
                setLinkOpen(false);
              }}
            >
              Insert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RichNoteEditor;

const TableSizePicker: React.FC<{ onPick: (rows: number, cols: number) => void; maxRows?: number; maxCols?: number }> = ({ onPick, maxRows = 6, maxCols = 6 }) => {
  const [hover, setHover] = React.useState<{ r: number; c: number }>({ r: 0, c: 0 });
  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${maxCols}, 16px)` }}>
        {Array.from({ length: maxRows }).map((_, r) => (
          Array.from({ length: maxCols }).map((_, c) => {
            const active = r <= hover.r && c <= hover.c;
            return (
              <div
                key={`${r}-${c}`}
                className={`h-4 w-4 border ${active ? 'bg-primary/40 border-primary' : 'bg-muted border-muted-foreground/20'}`}
                onMouseEnter={() => setHover({ r, c })}
                onClick={() => onPick(r + 1, c + 1)}
              />
            );
          })
        ))}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{hover.r + 1} x {hover.c + 1}</div>
    </div>
  );
};
