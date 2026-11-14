/**
 * Clickable API page for development, generated from the contract with Scalar.
 * Served only by the dev server: the page loads Scalar from a CDN, which we
 * do not want in a customer's production environment.
 */

/** Pinned version, updated deliberately. */
export const SCALAR_VERSION = '1.76.4';

export interface DocsOptions {
  /** Where the contract is served, e.g. '/openapi.yaml'. */
  specUrl: string;
  /** Token prefilled on the page, e.g. 'dev-handler'. */
  defaultToken?: string;
}

export function docsPage({ specUrl, defaultToken }: DocsOptions): string {
  const config = {
    url: specUrl,
    hideClientButton: false,
    defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
    authentication: defaultToken
      ? { preferredSecurityScheme: 'bearerAuth', securitySchemes: { bearerAuth: { token: defaultToken } } }
      : undefined,
  };
  return `<!doctype html>
<html lang="sv">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Petvold API</title>
</head>
<body>
  <div id="app"></div>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}"></script>
  <script>Scalar.createApiReference('#app', ${JSON.stringify(config)});</script>
</body>
</html>`;
}
