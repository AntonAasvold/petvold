/**
 * Documents (ADR 0038): files on claims, policies and notices, kept in an
 * archive (object storage behind BlobStore) with their checksum, and opened
 * through links that expire, are logged and can be revoked. Other modules keep
 * only a document's id, never the file or an address.
 *
 * Step 1: uploads and links. PDFs from templates (Gotenberg) come in step 3.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type Timestamp = string;

/** What a document belongs to. The access to it follows that (ADR 0038 point 6). */
export interface DocumentOwner {
  claimId?: string;
  policyId?: string;
  noticeId?: string;
}

export interface StoredDocument {
  id: string;
  kind: 'uploaded' | 'generated';
  mediaType: string;
  /** In bytes. */
  size: number;
  /** sha256 of the bytes, lowercase hex. Checked when stored and when read. */
  sha256: string;
  /** The name it was uploaded with, for display. */
  filename?: string;
  owner: DocumentOwner;
  /** The parties the document concerns, set when it is made: for a customer's list of documents. */
  partyIds: string[];
  market: string;
  createdBy: string;
  createdAt: Timestamp;
  /** The file was removed by retention (ADR 0028); the record stays. */
  erasedAt?: Timestamp;
}

export type LinkAudience = 'internal' | 'customer';

/** A link to a document that expires (ADR 0038 point 5). The address never names the document. */
export interface DocumentLink {
  id: string;
  documentId: string;
  /** internal: a person in the back office; customer: given to the customer, e.g. in a portal or an e-mail. */
  audience: LinkAudience;
  createdBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  revokedBy?: string;
  revokedAt?: Timestamp;
  /** When it was opened, oldest first. */
  accesses: Timestamp[];
}

export interface DocumentFilter {
  partyId?: string;
  claimId?: string;
  policyId?: string;
}

/** The documents' records. Postgres in production, memory in tests. */
export interface DocumentStore {
  save(d: StoredDocument): Promise<void>;
  get(id: string): Promise<StoredDocument | null>;
  /** Newest first. */
  list(filter: DocumentFilter): Promise<StoredDocument[]>;
  saveLink(l: DocumentLink): Promise<void>;
  getLink(id: string): Promise<DocumentLink | null>;
  /** The document's links, newest first. */
  links(documentId: string): Promise<DocumentLink[]>;
  /** Throws DocumentConflictError if the link is revoked already. */
  revokeLink(id: string, by: string, at: Timestamp): Promise<void>;
  logAccess(linkId: string, at: Timestamp): Promise<void>;
}

/** The archive's files, by key. An S3-compatible store in production (s3.ts), memory in tests. */
export interface BlobStore {
  put(key: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  /** null if there is no such file. */
  get(key: string): Promise<Uint8Array | null>;
}

export class DocumentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentConflictError';
  }
}

export type DocumentErrorCode = 'validation' | 'not_found' | 'conflict' | 'gone';

export class DocumentError extends Error {
  constructor(
    public readonly code: DocumentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentError';
  }
}

/** Uploads at most 25 MB (ADR 0038). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** What may be uploaded, and how each file starts: the content must match the media type. */
export const UPLOAD_TYPES: Readonly<Record<string, (b: Uint8Array) => boolean>> = {
  'application/pdf': (b) => ascii(b, 0, 5) === '%PDF-',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && ascii(b, 1, 4) === 'PNG',
  'image/heic': (b) => ascii(b, 4, 8) === 'ftyp' && ['heic', 'heix', 'mif1', 'msf1', 'heim', 'heis'].includes(ascii(b, 8, 12)),
};

function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.subarray(from, to));
}

/** Link lifetimes (ADR 0038): a back office link 15 minutes, a customer's at most 7 days. */
export const LINK_DEFAULTS = { internalSeconds: 15 * 60, customerSeconds: 15 * 60, maxCustomerSeconds: 7 * 24 * 3600 };

export interface DocumentsDeps {
  store: DocumentStore;
  blobs: BlobStore;
  clock: { now(): Timestamp };
  ids: { next(prefix: string): string };
  /** At least 32 bytes: signs the links. */
  signingKey: Uint8Array;
  /** Where links are opened, e.g. https://petvold.insurer.example. The link is `${base}/d/{token}`. */
  publicBaseUrl: string;
  /** The longest a customer's link may last, in seconds. Default 7 days. */
  maxCustomerLinkSeconds?: number;
}

export interface UploadInput {
  bytes: Uint8Array;
  mediaType: string;
  filename?: string;
  owner: DocumentOwner;
  partyIds: string[];
  market: string;
}

export class DocumentService {
  constructor(private readonly d: DocumentsDeps) {
    if (d.signingKey.length < 32) throw new Error('The documents signing key must be at least 32 bytes');
  }

  /**
   * Stores an uploaded file (ADR 0038 point 4): at most 25 MB, of an allowed
   * media type that its content matches. Petvold computes the checksum itself.
   * The file goes to the archive first, then the record, so a record never
   * points to a missing file.
   */
  async upload(input: UploadInput, by: string): Promise<StoredDocument> {
    const fail = (m: string): never => {
      throw new DocumentError('validation', m);
    };
    const mediaType = (input.mediaType ?? '').toLowerCase().split(';')[0]!.trim();
    const matches = UPLOAD_TYPES[mediaType];
    if (!matches) fail(`The media type is one of ${Object.keys(UPLOAD_TYPES).join(', ')}`);
    if (!input.bytes.length) fail('The file is empty');
    if (input.bytes.length > MAX_UPLOAD_BYTES) fail(`The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
    if (!matches!(input.bytes)) fail(`The file is not ${mediaType}`);
    if (!input.owner.claimId && !input.owner.policyId && !input.owner.noticeId) fail('A document belongs to a claim, a policy or a notice');
    const filename = input.filename?.replace(/[\u0000-\u001f\\/]/g, '').trim().slice(0, 200);
    const doc: StoredDocument = {
      id: this.d.ids.next('doc'),
      kind: 'uploaded',
      mediaType,
      size: input.bytes.length,
      sha256: sha256(input.bytes),
      ...(filename ? { filename } : {}),
      owner: { ...input.owner },
      partyIds: [...new Set(input.partyIds)].sort(),
      market: input.market,
      createdBy: by,
      createdAt: this.d.clock.now(),
    };
    await this.d.blobs.put(doc.id, input.bytes, mediaType);
    await this.d.store.save(doc);
    return doc;
  }

  async get(id: string): Promise<StoredDocument> {
    const doc = await this.d.store.get(id);
    if (!doc) throw new DocumentError('not_found', `Document ${id} does not exist`);
    return doc;
  }

  async list(filter: DocumentFilter): Promise<StoredDocument[]> {
    if (!filter.partyId && !filter.claimId && !filter.policyId) throw new DocumentError('validation', 'Give partyId, claimId or policyId');
    return this.d.store.list(filter);
  }

  /**
   * A link to the document that expires (ADR 0038 point 5). The token is a
   * random id and a signature; it names neither the document nor the customer.
   * An erased document gets no links.
   */
  async createLink(documentId: string, input: { audience: LinkAudience; seconds?: number }, by: string): Promise<{ link: DocumentLink; url: string }> {
    const doc = await this.get(documentId);
    if (doc.erasedAt) throw new DocumentError('gone', `Document ${documentId} is erased`);
    if (input.audience !== 'internal' && input.audience !== 'customer') throw new DocumentError('validation', 'audience is internal or customer');
    const max = input.audience === 'internal' ? LINK_DEFAULTS.internalSeconds : (this.d.maxCustomerLinkSeconds ?? LINK_DEFAULTS.maxCustomerSeconds);
    const seconds = input.seconds ?? (input.audience === 'internal' ? LINK_DEFAULTS.internalSeconds : LINK_DEFAULTS.customerSeconds);
    if (!Number.isInteger(seconds) || seconds < 60 || seconds > max) throw new DocumentError('validation', `seconds is 60 to ${max} for a link to ${input.audience === 'internal' ? 'a person here' : 'the customer'}`);
    const now = this.d.clock.now();
    const link: DocumentLink = {
      id: `lnk_${randomBytes(18).toString('base64url')}`,
      documentId,
      audience: input.audience,
      createdBy: by,
      createdAt: now,
      expiresAt: new Date(Date.parse(now) + seconds * 1000).toISOString(),
      accesses: [],
    };
    await this.d.store.saveLink(link);
    return { link, url: `${this.d.publicBaseUrl.replace(/\/$/, '')}/d/${this.token(link.id)}` };
  }

  /** The document's links with when each was opened: who has seen it (GDPR art. 15). */
  async links(documentId: string): Promise<DocumentLink[]> {
    await this.get(documentId);
    return this.d.store.links(documentId);
  }

  async revokeLink(documentId: string, linkId: string, by: string): Promise<DocumentLink> {
    const link = await this.d.store.getLink(linkId);
    if (!link || link.documentId !== documentId) throw new DocumentError('not_found', `Link ${linkId} does not exist`);
    await this.d.store.revokeLink(linkId, by, this.d.clock.now()).catch((e: unknown) => {
      if (e instanceof DocumentConflictError) throw new DocumentError('conflict', e.message);
      throw e;
    });
    return (await this.d.store.getLink(linkId))!;
  }

  /**
   * Opens a link: checks the signature, that the link is neither expired nor
   * revoked and the document not erased, logs the access, and returns the file
   * after checking its checksum. Every failure is 'gone', so the answer says
   * nothing about why.
   */
  async open(token: string): Promise<{ document: StoredDocument; bytes: Uint8Array }> {
    const gone = () => new DocumentError('gone', 'The link does not work');
    const linkId = this.verify(token);
    if (!linkId) throw gone();
    const link = await this.d.store.getLink(linkId);
    const now = this.d.clock.now();
    if (!link || link.revokedAt || Date.parse(link.expiresAt) <= Date.parse(now)) throw gone();
    const doc = await this.d.store.get(link.documentId);
    if (!doc || doc.erasedAt) throw gone();
    const bytes = await this.d.blobs.get(doc.id);
    if (!bytes) throw new Error(`The file of document ${doc.id} is missing from the archive`);
    if (sha256(bytes) !== doc.sha256) throw new Error(`The file of document ${doc.id} does not match its checksum`);
    await this.d.store.logAccess(link.id, now);
    return { document: doc, bytes };
  }

  private token(linkId: string): string {
    return `${linkId}.${this.signature(linkId)}`;
  }

  private signature(linkId: string): string {
    return createHmac('sha256', this.d.signingKey).update(linkId).digest('base64url');
  }

  /** The link id of a well-formed token with a valid signature, else null. */
  private verify(token: string): string | null {
    const m = /^(lnk_[A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!m) return null;
    const want = Buffer.from(this.signature(m[1]!));
    const got = Buffer.from(m[2]!);
    return want.length === got.length && timingSafeEqual(want, got) ? m[1]! : null;
  }
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** In-memory records, for tests and the dev server without a database. */
export class InMemoryDocumentStore implements DocumentStore {
  private docs: StoredDocument[] = [];
  private linksById = new Map<string, DocumentLink>();

  async save(d: StoredDocument) {
    if (this.docs.some((x) => x.id === d.id)) throw new DocumentConflictError(`Document ${d.id} exists`);
    this.docs.push(structuredClone(d));
  }
  async get(id: string) {
    const d = this.docs.find((x) => x.id === id);
    return d ? structuredClone(d) : null;
  }
  async list(f: DocumentFilter) {
    return this.docs
      .filter((d) => (!f.partyId || d.partyIds.includes(f.partyId)) && (!f.claimId || d.owner.claimId === f.claimId) && (!f.policyId || d.owner.policyId === f.policyId))
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : a.id < b.id ? 1 : -1))
      .map((d) => structuredClone(d));
  }
  async saveLink(l: DocumentLink) {
    if (!this.docs.some((d) => d.id === l.documentId)) throw new Error(`Document ${l.documentId} does not exist`);
    this.linksById.set(l.id, structuredClone(l));
  }
  async getLink(id: string) {
    const l = this.linksById.get(id);
    return l ? structuredClone(l) : null;
  }
  async links(documentId: string) {
    return [...this.linksById.values()]
      .filter((l) => l.documentId === documentId)
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : a.id < b.id ? 1 : -1))
      .map((l) => structuredClone(l));
  }
  async revokeLink(id: string, by: string, at: Timestamp) {
    const l = this.linksById.get(id);
    if (!l) throw new Error(`Link ${id} does not exist`);
    if (l.revokedAt) throw new DocumentConflictError(`Link ${id} is revoked already`);
    Object.assign(l, { revokedBy: by, revokedAt: at });
  }
  async logAccess(linkId: string, at: Timestamp) {
    this.linksById.get(linkId)?.accesses.push(at);
  }
}

/** In-memory files, for tests and the dev server without object storage. */
export class InMemoryBlobStore implements BlobStore {
  private files = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) {
    if (this.files.has(key)) throw new Error(`File ${key} exists: files never change`);
    this.files.set(key, new Uint8Array(bytes));
  }
  async get(key: string) {
    const b = this.files.get(key);
    return b ? new Uint8Array(b) : null;
  }
}
