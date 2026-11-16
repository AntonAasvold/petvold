/**
 * The Petvold components (design/components.css) as a Lit stylesheet, so a
 * component can use the pv- classes in its shadow DOM. One source: the CSS file
 * is read as text at build time. See https://lit.dev/docs/components/styles/.
 */
import { unsafeCSS } from 'lit';
import componentsCss from '../../../../design/components.css?inline';

export const pvComponents = unsafeCSS(componentsCss);
