import { NoteCard } from "./NoteCard";

interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  pinned?: boolean;
}

interface NotesGridProps {
  notes: Note[];
  onNoteClick: (note: Note) => void;
  onDeleteNote?: (note: Note) => void;
  onSuggestTitle?: (note: Note) => void;
  onTogglePin?: (note: Note) => void;
}

export const NotesGrid = ({ notes, onNoteClick, onDeleteNote, onSuggestTitle, onTogglePin }: NotesGridProps) => {
  if (notes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No notes yet. Add your first note to get started!
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          title={note.title}
          content={note.content}
          updatedAt={note.updatedAt}
          pinned={note.pinned}
          onTogglePin={onTogglePin ? () => onTogglePin(note) : undefined}
          onClick={() => onNoteClick(note)}
          onDelete={onDeleteNote ? () => onDeleteNote(note) : undefined}
          onSuggestTitle={onSuggestTitle ? () => onSuggestTitle(note) : undefined}
        />
      ))}
    </div>
  );
};
