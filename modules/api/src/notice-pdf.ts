/**
 * A notice as a PDF from Petvold's templates (ADR 0038). Used by the API, when
 * a person asks for it, and by the relay, when the market's setting says that
 * Petvold makes the notices' documents.
 */
import type { AnimalService } from '@petvold/animals';
import type { CommunicationsService, Notice } from '@petvold/communications';
import type { DocumentService, StoredDocument } from '@petvold/documents';
import type { PartyService } from '@petvold/parties';
import { renderRule, type Locale } from './messages.ts';

export interface NoticePdfDeps {
  documents: DocumentService;
  communications: CommunicationsService;
  parties: PartyService;
  animals: AnimalService;
  clock: { now(): string };
}

/**
 * Makes the notice a PDF. Names, the address and the animal's name are read
 * now and never stored as data. A notice whose document Petvold makes gets
 * the first PDF as its document.
 */
export async function makeNoticePdf(d: NoticePdfDeps, n: Notice, by: string): Promise<StoredDocument> {
  const recipient = await d.parties.get(n.recipientPartyId).catch(() => null);
  const name = recipient ? (recipient.name ?? [recipient.givenName, recipient.familyName].filter(Boolean).join(' ')) : '';
  const address = recipient?.address ? [recipient.address.street, `${recipient.address.postalCode} ${recipient.address.city}`] : [];
  const animalId = typeof n.content.animalId === 'string' ? n.content.animalId : undefined;
  const animal = animalId ? await d.animals.get(animalId).catch(() => null) : null;
  const locale: Locale = n.language === 'sv' ? 'sv' : 'en';
  const doc = await d.documents.generate(
    {
      template: n.type,
      market: n.market,
      language: n.language,
      data: n.content,
      context: {
        now: d.clock.now(),
        ...(recipient ? { recipient: { name, addressLines: address } } : {}),
        ...(typeof n.content.sender === 'string' ? { sender: n.content.sender } : {}),
        ...(animal ? { animalName: animal.name } : {}),
        reason: (x) => renderRule(x, locale),
      },
      owner: { noticeId: n.id, ...(n.policyId ? { policyId: n.policyId } : {}), ...(typeof n.content.claimId === 'string' ? { claimId: n.content.claimId } : {}) },
      partyIds: [n.recipientPartyId],
    },
    by,
  );
  if (n.documentMaker === 'petvold' && !n.document) await d.communications.addDocument(n.id, { id: doc.id, sha256: doc.sha256 }, by);
  return doc;
}

/**
 * The relay's step after notice.created: the PDF of a notice whose document
 * Petvold makes, once. A PDF made before a crash is used rather than made
 * again. Returns the document, or null when there is nothing to do.
 */
export async function ensureNoticePdf(d: NoticePdfDeps, noticeId: string): Promise<StoredDocument | null> {
  const n = await d.communications.get(noticeId);
  if (n.documentMaker !== 'petvold' || n.document) return null;
  const earlier = (await d.documents.list({ noticeId })).find((x) => x.kind === 'generated');
  if (earlier) {
    await d.communications.addDocument(n.id, { id: earlier.id, sha256: earlier.sha256 }, 'petvold');
    return earlier;
  }
  return makeNoticePdf(d, n, 'petvold');
}
