/**
 * 把笔记保存到指定 doc KB:Tiptap JSON → markdown → upload_docs。
 */
import { kb } from '@chayuan/api';
import { tiptapJsonToMarkdown } from './tiptapToMarkdown';

export async function saveNoteToKB(args: {
  title: string;
  content: any; // Tiptap JSON
  kbName: string;
}): Promise<{ saved_files: string[]; failed: Record<string, string> }> {
  const markdown = tiptapJsonToMarkdown(args.content);
  const safeTitle = (args.title || 'note').replace(/[/\\?%*:|"<>]/g, '-').slice(0, 100);
  const file = new File([markdown], `${safeTitle}.md`, { type: 'text/markdown' });
  const r = await kb.uploadDocs({
    files: [file],
    knowledge_base_name: args.kbName,
    override: true,
    to_vector_store: true,
  });
  return {
    saved_files: r.data?.saved_files ?? [],
    failed: r.data?.failed_saves ?? {},
  };
}
