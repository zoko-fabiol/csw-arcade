/**
 * Mise en page standard à 2 colonnes (Barre latérale contextuelle + Espace principal)
 * partagée par tous les modes natifs pour une ergonomie identique.
 */

import { h } from './ui.js';
import { icon } from './icons.js';

export function createModeLayout({ sidebarSections, activeKey, onSelect, mobileOpen, onCloseMobile }) {
  const sidebar = h(
    'aside',
    { className: `csw-sidebar ${mobileOpen ? 'is-open' : ''}`, 'aria-label': 'Navigation du mode' },
    h(
      'div',
      { className: 'csw-sidebar-mobile-head' },
      h('span', { className: 'csw-sidebar-label' }, 'Navigation'),
      h(
        'button',
        {
          type: 'button',
          className: 'csw-icon-btn',
          'aria-label': 'Fermer le menu',
          onClick: onCloseMobile,
        },
        '✕'
      )
    ),
    h(
      'div',
      { className: 'csw-sidebar-scroll' },
      sidebarSections.map((sec) =>
        h(
          'div',
          { className: 'csw-sidebar-group' },
          h('div', { className: 'csw-sidebar-label' }, sec.label),
          h(
            'div',
            { className: 'csw-sidebar-list' },
            sec.items.map((item) => {
              const isActive = activeKey === item.id;
              return h(
                'button',
                {
                  type: 'button',
                  className: `csw-nav-item ${isActive ? 'is-active' : ''}`,
                  onClick: () => {
                    onSelect(item.id);
                    onCloseMobile?.();
                  },
                },
                h(
                  'span',
                  { className: 'csw-nav-item-left' },
                  h(
                    'span',
                    { className: 'csw-nav-icon' },
                    item.icon instanceof Node
                      ? item.icon
                      : icon(typeof item.icon === 'string' && /^[a-zA-Z]+$/.test(item.icon) ? item.icon : 'gamepad', 15)
                  ),
                  h('span', {}, item.label)
                ),
                item.badge !== undefined
                  ? h('span', { className: 'csw-nav-badge' }, String(item.badge))
                  : null
              );
            })
          )
        )
      )
    )
  );

  const backdrop = h('div', {
    className: `csw-sidebar-backdrop ${mobileOpen ? 'is-open' : ''}`,
    onClick: onCloseMobile,
  });

  const main = h('div', { className: 'csw-main-panel' });
  const root = h('div', { className: 'csw-mode-layout' }, backdrop, sidebar, main);

  return { root, main, sidebar };
}
