/**
 * Documents in the back office (ADR 0038): what an upload needs, and how a
 * customer's document is opened. Pure; tested with node:test.
 */

/** As the API: at most 25 MB, and these media types. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const UPLOAD_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'] as const;

/** What is wrong with a chosen file, as message ids. Empty: it may be uploaded. */
export function uploadProblems(file: { size: number; type: string } | null): string[] {
  if (!file) return ['document.needFile'];
  const out: string[] = [];
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) out.push('document.badType');
  if (file.size > MAX_UPLOAD_BYTES) out.push('document.tooLarge');
  if (file.size === 0) out.push('document.empty');
  return out;
}

/** An attachment's address for a file in Petvold's archive. */
export const archiveUrl = (documentId: string) => `urn:petvold:doc:${documentId}`;

/** The document id of an address in Petvold's archive, else null. */
export function archivedDocumentId(url: string): string | null {
  const m = /^urn:petvold:doc:(doc_[A-Za-z0-9_]+)$/.exec(url);
  return m ? m[1]! : null;
}

export interface CustomerDocumentLike {
  source: 'petvold' | 'insurer';
  type: 'attachment' | 'notice';
  documentId?: string;
  url?: string;
  archiveId?: string;
  erased?: boolean;
}

/**
 * How a customer's document opens: a link from Petvold's archive, the
 * insurer's address, or only its id in the insurer's archive.
 */
export function openWith(d: CustomerDocumentLike): { kind: 'link'; documentId: string } | { kind: 'address'; url: string } | { kind: 'reference'; id: string } | { kind: 'none' } {
  if (d.erased) return { kind: 'none' };
  if (d.source === 'petvold' && d.documentId) return { kind: 'link', documentId: d.documentId };
  if (d.url && /^https:\/\//i.test(d.url)) return { kind: 'address', url: d.url };
  if (d.archiveId ?? d.url) return { kind: 'reference', id: (d.archiveId ?? d.url)! };
  return { kind: 'none' };
}
