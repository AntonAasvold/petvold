/** The back office (ADR 0035): Web Awesome's styles and Swedish texts, the Petvold theme and fonts, local icons, the language, the session and <pv-app>. */
import '@awesome.me/webawesome/dist/styles/webawesome.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
// Petvold design system: tokens first, then the theme that maps Web Awesome to them (docs/teknik/designsystem.md).
import './styles/petvold-tokens.css';
import './styles/petvold-theme.css';
import './icons.ts';
import { initialLocale, useLocale } from './i18n.ts';
import { sessionFromEnv } from './auth.ts';
import './components/app-shell.ts';

await useLocale(initialLocale());
const app = document.createElement('pv-app');
app.session = sessionFromEnv(import.meta.env);
app.apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
document.body.append(app);
