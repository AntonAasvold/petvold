/**
 * <wa-icon> reads Font Awesome Free icons from the app itself (public/icons,
 * copied by scripts/copy-icons.mjs), never from a CDN. The list is icons.json.
 */
import { registerIconLibrary } from '@awesome.me/webawesome/dist/components/icon/library.js';

registerIconLibrary('default', {
  resolver: (name, _family, variant) => `${import.meta.env.BASE_URL}icons/${variant === 'regular' ? 'regular' : 'solid'}/${name}.svg`,
  mutator: (svg) => svg.setAttribute('fill', 'currentColor'),
});
