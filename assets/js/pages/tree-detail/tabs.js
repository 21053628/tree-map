import { ensureStaff } from './auth-gate.js';

export function initTabs() {
  const tabs = Array.from(document.querySelectorAll('.tree-tab'));
  if (!tabs.length) return;
  let activeTab = tabs[0];

  function setActive(tab) {
    const panelId = tab.getAttribute('aria-controls');
    tabs.forEach(function (item) {
      const selected = item === tab;
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
      item.setAttribute('tabindex', selected ? '0' : '-1');
    });
    document.querySelectorAll('.tab-panel').forEach(function (panel) {
      panel.hidden = panel.id !== panelId;
    });
    activeTab = tab;
  }

  async function selectTab(tab, shouldFocus) {
    if (!tab || tab === activeTab) {
      if (shouldFocus && tab) tab.focus();
      return;
    }
    const panelId = tab.getAttribute('aria-controls');
    if (panelId !== 'overviewPanel') {
      const authorized = await ensureStaff();
      if (!authorized) {
        if (shouldFocus) activeTab.focus();
        return;
      }
    }
    setActive(tab);
    if (shouldFocus) tab.focus();
  }

  tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () { selectTab(tab, false); });
    tab.addEventListener('keydown', function (e) {
      let nextIndex = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIndex = 0;
      else if (e.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex !== -1) {
        e.preventDefault();
        selectTab(tabs[nextIndex], true);
      }
    });
  });

  setActive(tabs[0]);
}
