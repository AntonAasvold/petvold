export type CatalogErrorCode = 'not_found' | 'validation' | 'conflict' | 'forbidden';

export class CatalogError extends Error {
  constructor(
    public readonly code: CatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}
