/**
 * PDFs with Gotenberg (ADR 0038): Petvold sends finished HTML, and Gotenberg's
 * Chromium turns it into PDF/A-2b and PDF/UA-1. The container runs without
 * network for Chromium, so a template can never fetch anything.
 */
import type { PdfRenderer, RenderInput } from './index.ts';

export class GotenbergRenderer implements PdfRenderer {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 30_000,
  ) {}

  async render(input: RenderInput): Promise<Uint8Array> {
    const form = new FormData();
    form.append('files', new Blob([input.html], { type: 'text/html' }), 'index.html');
    for (const a of input.assets ?? []) form.append('files', new Blob([new Uint8Array(a.bytes)], { type: a.mediaType }), a.name);
    // A4 in inches, with the margins in the template's CSS.
    form.append('paperWidth', '8.27');
    form.append('paperHeight', '11.7');
    form.append('marginTop', '0');
    form.append('marginBottom', '0');
    form.append('marginLeft', '0');
    form.append('marginRight', '0');
    form.append('printBackground', 'true');
    form.append('stages', JSON.stringify([{ op: 'remediate', profile: ['PDF/A-2b', 'PDF/UA-1'] }]));
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/forms/chromium/convert/html`, { method: 'POST', body: form, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`Gotenberg answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Checks that Gotenberg answers, for the health check. */
  async ping(): Promise<void> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`Gotenberg's health answered ${res.status}`);
  }
}
