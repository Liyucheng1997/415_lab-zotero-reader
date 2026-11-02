import {
  FileText, BookOpen, Book, Presentation, GraduationCap, Globe, FileCode, ScrollText, Newspaper, FileBarChart, Scale, Database,
  StickyNote, Paperclip, Link2, File, Image, Lightbulb, Mail, Library, PenLine, Rss,
} from 'lucide-react';

const TYPE_ICONS = {
  journalArticle: FileText, conferencePaper: Presentation, preprint: ScrollText, book: Book, bookSection: BookOpen, thesis: GraduationCap,
  report: FileBarChart, standard: Scale, patent: Lightbulb, dataset: Database, computerProgram: FileCode, webpage: Globe, blogPost: Rss,
  magazineArticle: Newspaper, newspaperArticle: Newspaper, encyclopediaArticle: Library, presentation: Presentation, manuscript: PenLine,
  letter: Mail, document: File, note: StickyNote,
};

export function iconForItem(item) {
  if (item.itemType === 'attachment') {
    if (item.linkMode === 'linked_url') return Link2;
    if (item.contentType === 'application/pdf') return FileText;
    if (item.contentType?.startsWith('image/')) return Image;
    return Paperclip;
  }
  return TYPE_ICONS[item.itemType] || File;
}

export function TypeIcon({ item, size = 15, plain }) {
  const I = iconForItem(item);
  return <I size={size} strokeWidth={1.75} className={plain ? undefined : 'type-ico'} />;
}
