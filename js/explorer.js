const logTableBody = document.getElementById('log-table-body');
const logSearchInput = document.getElementById('log-search');
const logTypeFilter = document.getElementById('log-type-filter');
const logCountDisplay = document.getElementById('log-count-display');
const logPageDisplay = document.getElementById('log-page-display');
const logPrevBtn = document.getElementById('log-prev-btn');
const logNextBtn = document.getElementById('log-next-btn');

const statSummaryPixels = document.getElementById('summary-total-pixels');
const statSummaryUsers = document.getElementById('summary-total-users');
const statSummaryEvents = document.getElementById('summary-total-events');
const statSummaryTime = document.getElementById('summary-duration');

let communityEvents = [];
let currentPage = 1;
const PAGE_SIZE = 100;
let currentFiltered = [];

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

function getBadgeClass(type) {
  if (type === 'pixel_place') return 'badge-pixel';
  if (type.startsWith('chat')) return 'badge-chat';
  if (type.startsWith('admin')) return 'badge-admin';
  if (type.startsWith('shop')) return 'badge-shop';
  return '';
}

function getDataSource() {
  const typeFilter = logTypeFilter ? logTypeFilter.value : 'all';
  const hasPixelData = window.allPixels && window.allPixels.length > 0;

  if (typeFilter === 'pixel_place' && hasPixelData) {
    return window.allPixels;
  }
  if (typeFilter === 'all' && hasPixelData) {
    return {
      combined: true,
      pixels: window.allPixels,
      events: communityEvents
    };
  }
  return communityEvents;
}

function renderLogs(resetPage = true) {
  if (!logTableBody) return;
  if (resetPage) currentPage = 1;

  const search = (logSearchInput ? logSearchInput.value.toLowerCase().trim() : '');
  const typeFilter = (logTypeFilter ? logTypeFilter.value : 'all');
  const source = getDataSource();

  let matches = [];

  if (source && source.combined) {
    const matchedEvents = source.events.filter(ev => {
      if (search) {
        const u = (ev.data && (ev.data.username || ev.data.adminUsername)) || '';
        const m = (ev.data && (ev.data.message || ev.data.targetUsername)) || '';
        const text = `${ev.type} ${u} ${m} ${JSON.stringify(ev.data)}`.toLowerCase();
        return text.includes(search);
      }
      return true;
    });

    let matchedPixels = [];
    if (search) {
      for (let i = source.pixels.length - 1; i >= 0; i--) {
        const p = source.pixels[i];
        if (p.u && p.u.toLowerCase().includes(search)) {
          matchedPixels.push({
            t: p.t,
            type: 'pixel_place',
            data: { x: p.x, y: p.y, color: p.c, username: p.u }
          });
          if (matchedPixels.length >= 1000) break;
        }
      }
    } else {
      const sampleLimit = Math.min(500, source.pixels.length);
      for (let i = source.pixels.length - 1; i >= source.pixels.length - sampleLimit; i--) {
        const p = source.pixels[i];
        matchedPixels.push({
          t: p.t,
          type: 'pixel_place',
          data: { x: p.x, y: p.y, color: p.c, username: p.u }
        });
      }
    }

    matches = [...matchedEvents, ...matchedPixels].sort((a, b) => b.t - a.t);
  } else if (Array.isArray(source) && source === window.allPixels) {
    const rawMatches = [];
    for (let i = source.length - 1; i >= 0; i--) {
      const p = source[i];
      if (!search || (p.u && p.u.toLowerCase().includes(search))) {
        rawMatches.push({
          t: p.t,
          type: 'pixel_place',
          data: { x: p.x, y: p.y, color: p.c, username: p.u }
        });
        if (rawMatches.length >= 1500) break;
      }
    }
    matches = rawMatches;
  } else {
    matches = (source || []).filter(ev => {
      if (typeFilter !== 'all' && ev.type !== typeFilter) return false;
      if (search) {
        const u = (ev.data && (ev.data.username || ev.data.adminUsername)) || '';
        const m = (ev.data && (ev.data.message || ev.data.targetUsername)) || '';
        const text = `${ev.type} ${u} ${m} ${JSON.stringify(ev.data)}`.toLowerCase();
        return text.includes(search);
      }
      return true;
    }).sort((a, b) => b.t - a.t);
  }

  currentFiltered = matches;
  const totalPages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  if (logCountDisplay) {
    logCountDisplay.textContent = `${matches.length.toLocaleString()} events matching`;
  }
  if (logPageDisplay) {
    logPageDisplay.textContent = `Page ${currentPage} / ${totalPages}`;
  }
  if (logPrevBtn) logPrevBtn.disabled = (currentPage <= 1);
  if (logNextBtn) logNextBtn.disabled = (currentPage >= totalPages);

  logTableBody.innerHTML = '';
  if (matches.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="4" style="text-align:center; padding: 20px; color: var(--color-pencil-light);">No events matched your search filter.</td>`;
    logTableBody.appendChild(row);
    return;
  }

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageSlice = matches.slice(startIdx, startIdx + PAGE_SIZE);

  pageSlice.forEach(ev => {
    const row = document.createElement('tr');
    const badgeCls = getBadgeClass(ev.type);
    const user = (ev.data && (ev.data.username || ev.data.adminUsername)) || 'System';
    let detail = '';

    if (ev.type === 'pixel_place') {
      detail = `Placed (${ev.data.x}, ${ev.data.y}) <span style="display:inline-block;width:10px;height:10px;background:${ev.data.color};border:1px solid #2b2b2b;vertical-align:middle;margin-left:4px;"></span>`;
    } else if (ev.type === 'chat_send') {
      detail = `Message: "${String(ev.data.message || '').replace(/"/g, '&quot;')}"`;
    } else if (ev.type === 'admin_change_settings') {
      detail = `Updated: ${JSON.stringify(ev.data.changedSettings || {})}`;
    } else {
      detail = JSON.stringify(ev.data || {});
    }

    row.innerHTML = `
      <td>${formatTime(ev.t)}</td>
      <td><span class="badge-tag ${badgeCls}">${ev.type}</span></td>
      <td><strong>${user}</strong></td>
      <td>${detail}</td>
    `;
    logTableBody.appendChild(row);
  });
}

window.onPixelsLoaded = () => {
  renderLogs(false);
};

if (logPrevBtn) {
  logPrevBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderLogs(false);
    }
  });
}

if (logNextBtn) {
  logNextBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(currentFiltered.length / PAGE_SIZE);
    if (currentPage < totalPages) {
      currentPage++;
      renderLogs(false);
    }
  });
}

async function loadSummary() {
  try {
    const res = await fetch('data/event-summary.json');
    if (!res.ok) return;
    const data = await res.json();

    if (statSummaryPixels) statSummaryPixels.textContent = data.totalPixels.toLocaleString();
    if (statSummaryUsers) statSummaryUsers.textContent = data.uniqueUsers.toLocaleString();
    if (statSummaryEvents) statSummaryEvents.textContent = data.totalEvents.toLocaleString();

    if (statSummaryTime && data.eventStartTime && data.eventEndTime) {
      const days = Math.max(1, Math.round((data.eventEndTime - data.eventStartTime) / (1000 * 60 * 60 * 24)));
      statSummaryTime.textContent = `${days} Days`;
    }

    if (data.communityEvents) {
      communityEvents = data.communityEvents;
      renderLogs(true);
    }
  } catch (err) {
    console.error('Failed to load event summary:', err);
  }
}

if (logSearchInput) {
  let searchTimer = null;
  logSearchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderLogs(true), 200);
  });
}

if (logTypeFilter) {
  logTypeFilter.addEventListener('change', () => renderLogs(true));
}

const themeToggleBtn = document.getElementById('theme-toggle-btn');
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
  });
}

function activateTab(tabId) {
  document.querySelectorAll('.main-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === tabId);
  });
  if (tabId === 'tab-replay' && typeof renderBattleChart === 'function') {
    renderBattleChart();
  }
}

document.querySelectorAll('.main-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activateTab(btn.dataset.tab);
  });
});

document.querySelectorAll('[data-switch-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    activateTab(btn.dataset.switchTab);
    const target = document.getElementById(btn.dataset.switchTab);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

loadSummary();
