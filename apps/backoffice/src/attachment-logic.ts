/**
 * Attachments on a claim (ADR 0036): references to the insurer's archive with a
 * checksum. What may be added, what is missing, and which are replaced. The API
 * validates everything again. Pure; tested with node:test.
 */
import type { Me } from './permissions.ts';

export const ATTACHMENT_KINDS = ['invoice', 'medical-record', 'referral', 'photo', 'other'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface AttachmentForm {
  kind: AttachmentKind;
  url: string;
  sha256: string;
  mediaType: string;
  /** In bytes, as typed. */
  size: string;
  /** The attachment it replaces, or ''. */
  replaces: string;
}

export const emptyAttachment = (): AttachmentForm => ({ kind: 'invoice', url: '', sha256: '', mediaType: 'application/pdf', size: '', replaces: '' });

/** Attachments are added with claims:register while the claim is open. */
export const mayAddAttachment = (me: Me | null, status: string): boolean =>
  !!me?.permissions.includes('claims:register') && status !== 'withdrawn' && status !== 'dismissed';

export function attachmentProblems(f: AttachmentForm): string[] {
  const out: string[] = [];
  if (!/^(https:\/\/\S+|urn:[a-z0-9][a-z0-9-]{0,31}:\S+)$/i.test(f.url.trim())) out.push('attachment.badUrl');
  if (!/^[0-9a-f]{64}$/.test(f.sha256.trim().toLowerCase())) out.push('attachment.badSha');
  if (!/^[a-z]+\/[a-z0-9.+-]+$/i.test(f.mediaType.trim())) out.push('attachment.badMediaType');
  if (!/^\d+$/.test(f.size.trim()) || Number(f.size) < 1) out.push('attachment.badSize');
  return out;
}

export function attachmentBody(f: AttachmentForm) {
  return {
    kind: f.kind,
    url: f.url.trim(),
    sha256: f.sha256.trim().toLowerCase(),
    mediaType: f.mediaType.trim().toLowerCase(),
    size: Number(f.size.trim()),
    ...(f.replaces ? { replaces: f.replaces } : {}),
  };
}

/** The ids of attachments a later one replaced. */
export const replacedIds = (all: { replaces?: string }[]): Set<string> => new Set(all.flatMap((a) => (a.replaces ? [a.replaces] : [])));

/** A size for people: 184320 bytes as "180 kB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
