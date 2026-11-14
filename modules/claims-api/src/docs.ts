/**
 * Klickbar API-sida för utveckling, genererad från kontraktet med Scalar.
 * Serveras bara av dev-servern: sidan hämtar Scalar från ett CDN, och det vill
 * vi inte i en kunds driftmiljö.
 */

/** Låst version, uppdateras medvetet. */
export const SCALAR_VERSION = '1.76.4';

export interface DocsOptions {
  /** Var kontraktet finns, t.ex. '/openapi.yaml'. */
  specUrl: string;
  /** Token som fylls i från början, t.ex. 'dev-handler'. */
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
  <title>Petvold – Claims API</title>
</head>
<body>
  <div id="app"></div>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}"></script>
  <script>Scalar.createApiReference('#app', ${JSON.stringify(config)});</script>
</body>
</html>`;
}
