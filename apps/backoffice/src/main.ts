/** The back office (ADR 0035): Web Awesome's styles and Swedish texts, local icons, the language, the session and <pv-app>. */
import '@awesome.me/webawesome/dist/styles/webawesome.css';
import './icons.ts';
import { initialLocale, useLocale } from './i18n.ts';
import { sessionFromEnv } from './auth.ts';
import './components/app-shell.ts';

await useLocale(initialLocale());
const app = document.createElement('pv-app');
app.session = sessionFromEnv(import.meta.env);
app.apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
document.body.append(app);
