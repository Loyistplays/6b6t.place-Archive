const canvas = document.getElementById('timelapse-canvas');
const ctx = canvas.getContext('2d');
const viewport = document.getElementById('canvas-viewport');

const chartCanvas = document.getElementById('battle-chart-canvas');
const chartCtx = chartCanvas.getContext('2d');
const battleLegend = document.getElementById('battle-legend');

const playBtn = document.getElementById('play-btn');
const resetBtn = document.getElementById('reset-btn');
const timelineSlider = document.getElementById('timeline-slider');
const speedInput = document.getElementById('speed-input');
const recordBtn = document.getElementById('record-btn');
const recordTargetSelect = document.getElementById('record-target-select');
const recordQualitySelect = document.getElementById('record-quality-select');

const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomResetBtn = document.getElementById('zoom-reset-btn');
const zoomPill = document.getElementById('hud-zoom');
const coordsPill = document.getElementById('hud-coords');

const statTime = document.getElementById('stat-time');
const statTotal = document.getElementById('stat-total');
const statProgress = document.getElementById('stat-progress');
const playbackTimeLabel = document.getElementById('playback-time-label');

const tabTotalBtn = document.getElementById('tab-total');
const tabTerritoryBtn = document.getElementById('tab-territory');
const tabColorBtn = document.getElementById('tab-color');
const tabLiveColorBtn = document.getElementById('tab-livecolor');
const leaderboardList = document.getElementById('leaderboard-list');

let pixels = [];
let currentIndex = 0;
let isPlaying = false;
let speed = 75;
let zoom = 1.0;
let panX = 0;
let panY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let animationFrameId = null;

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recorderCanvas = null;
let recorderCtx = null;
let recorderAnimId = null;

let userCounts = {};
let lastLeaderboardUpdate = 0;
let lastChartUpdate = 0;

let activeTab = 'total';
let chartHistoryTotal = [];
let chartHistoryTerritory = [];
let chartHistoryColors = [];
let chartHistoryLiveColors = [];

const COLOR_PALETTE = [
  '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#f43f5e', '#84cc16', '#a855f7', '#14b8a6',
  '#f97316', '#6366f1', '#e11d48', '#22c55e', '#d946ef', '#0ea5e9'
];

function isAirColor(color) {
  if (!color) return true;
  return color.toUpperCase() === '#EADDC9';
}

function isIgnoredPlacement(user, color) {
  if (isAirColor(color)) return true;
  if (!user) return false;
  return user.toLowerCase() === 'system';
}

function getItemColor(key, isColor = false) {
  if (isColor) return key;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) & 0xffffffff;
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

function userClean(u) {
  return String(u).replace(/[^a-zA-Z0-9]/g, '_');
}

function switchTab(tab) {
  if (activeTab === tab) return;
  activeTab = tab;
  [tabTotalBtn, tabTerritoryBtn, tabColorBtn, tabLiveColorBtn].forEach(b => {
    if (b) b.classList.remove('active');
  });
  if (tab === 'total' && tabTotalBtn) tabTotalBtn.classList.add('active');
  else if (tab === 'territory' && tabTerritoryBtn) tabTerritoryBtn.classList.add('active');
  else if (tab === 'color' && tabColorBtn) tabColorBtn.classList.add('active');
  else if (tab === 'livecolor' && tabLiveColorBtn) tabLiveColorBtn.classList.add('active');
  renderBattleLegend();
  renderBattleChart();
}

if (tabTotalBtn) tabTotalBtn.addEventListener('click', () => switchTab('total'));
if (tabTerritoryBtn) tabTerritoryBtn.addEventListener('click', () => switchTab('territory'));
if (tabColorBtn) tabColorBtn.addEventListener('click', () => switchTab('color'));
if (tabLiveColorBtn) tabLiveColorBtn.addEventListener('click', () => switchTab('livecolor'));

function initCanvas(w = 256, h = 256) {
  canvas.width = w;
  canvas.height = h;
  ctx.fillStyle = '#EADDC9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  updateTransform();
}

function updateTransform() {
  canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  if (zoomPill) zoomPill.textContent = `Zoom: ${Math.round(zoom * 100)}%`;
}

viewport.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    isDragging = true;
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
  }
});

window.addEventListener('mousemove', (e) => {
  if (isDragging) {
    panX = e.clientX - dragStartX;
    panY = e.clientY - dragStartY;
    updateTransform();
  }
  const rect = canvas.getBoundingClientRect();
  const mouseX = Math.floor((e.clientX - rect.left) / zoom);
  const mouseY = Math.floor((e.clientY - rect.top) / zoom);
  if (coordsPill && mouseX >= 0 && mouseX < canvas.width && mouseY >= 0 && mouseY < canvas.height) {
    coordsPill.textContent = `X: ${mouseX}, Y: ${mouseY}`;
  }
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 1.2 : 0.83;
  zoom = Math.min(16, Math.max(0.5, zoom * delta));
  updateTransform();
}, { passive: false });

let touchStartDist = 0;
let touchStartZoom = 1;
let isTouching = false;
let touchStartX = 0;
let touchStartY = 0;

viewport.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    isTouching = true;
    touchStartX = e.touches[0].clientX - panX;
    touchStartY = e.touches[0].clientY - panY;
  } else if (e.touches.length === 2) {
    isTouching = false;
    touchStartDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    touchStartZoom = zoom;
  }
}, { passive: true });

viewport.addEventListener('touchmove', (e) => {
  if (e.touches.length === 1 && isTouching) {
    panX = e.touches[0].clientX - touchStartX;
    panY = e.touches[0].clientY - touchStartY;
    updateTransform();
    const rect = canvas.getBoundingClientRect();
    const touchX = Math.floor((e.touches[0].clientX - rect.left) / zoom);
    const touchY = Math.floor((e.touches[0].clientY - rect.top) / zoom);
    if (coordsPill && touchX >= 0 && touchX < canvas.width && touchY >= 0 && touchY < canvas.height) {
      coordsPill.textContent = `X: ${touchX}, Y: ${touchY}`;
    }
  } else if (e.touches.length === 2 && touchStartDist > 0) {
    const currentDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const ratio = currentDist / touchStartDist;
    zoom = Math.min(16, Math.max(0.5, touchStartZoom * ratio));
    updateTransform();
  }
}, { passive: true });

viewport.addEventListener('touchend', (e) => {
  if (e.touches.length === 0) {
    isTouching = false;
    touchStartDist = 0;
  } else if (e.touches.length === 1) {
    isTouching = true;
    touchStartX = e.touches[0].clientX - panX;
    touchStartY = e.touches[0].clientY - panY;
    touchStartDist = 0;
  }
}, { passive: true });

if (zoomInBtn) {
  zoomInBtn.addEventListener('click', () => {
    zoom = Math.min(16, zoom * 1.3);
    updateTransform();
  });
}
if (zoomOutBtn) {
  zoomOutBtn.addEventListener('click', () => {
    zoom = Math.max(0.5, zoom / 1.3);
    updateTransform();
  });
}
if (zoomResetBtn) {
  zoomResetBtn.addEventListener('click', () => {
    zoom = 1.0;
    panX = 0;
    panY = 0;
    updateTransform();
  });
}

function preprocessChartData() {
  if (pixels.length === 0) {
    chartHistoryTotal = [];
    chartHistoryTerritory = [];
    chartHistoryColors = [];
    chartHistoryLiveColors = [];
    return;
  }

  const totalSteps = Math.min(300, pixels.length);
  const stepSize = Math.max(1, Math.floor(pixels.length / totalSteps));

  chartHistoryTotal = [];
  chartHistoryTerritory = [];
  chartHistoryColors = [];
  chartHistoryLiveColors = [];

  const cumulativeCounts = {};
  const cumulativeColors = {};
  const territoryUserMap = new Map();
  const currentTerritory = {};
  const territoryColorMap = new Map();
  const currentLiveColors = {};

  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    const u = p.u || 'anonymous';
    const c = (p.c || '#000000').toUpperCase();
    const key = (p.x << 16) | (p.y & 0xFFFF);

    if (!isIgnoredPlacement(u, c)) {
      cumulativeCounts[u] = (cumulativeCounts[u] || 0) + 1;
      cumulativeColors[c] = (cumulativeColors[c] || 0) + 1;

      const prevOwner = territoryUserMap.get(key);
      if (prevOwner && currentTerritory[prevOwner]) {
        currentTerritory[prevOwner]--;
      }
      territoryUserMap.set(key, u);
      currentTerritory[u] = (currentTerritory[u] || 0) + 1;

      const prevColor = territoryColorMap.get(key);
      if (prevColor && currentLiveColors[prevColor]) {
        currentLiveColors[prevColor]--;
      }
      territoryColorMap.set(key, c);
      currentLiveColors[c] = (currentLiveColors[c] || 0) + 1;
    } else {
      const prevOwner = territoryUserMap.get(key);
      if (prevOwner && currentTerritory[prevOwner]) {
        currentTerritory[prevOwner]--;
      }
      territoryUserMap.delete(key);

      const prevColor = territoryColorMap.get(key);
      if (prevColor && currentLiveColors[prevColor]) {
        currentLiveColors[prevColor]--;
      }
      territoryColorMap.delete(key);
    }

    if (i % stepSize === 0 || i === pixels.length - 1) {
      chartHistoryTotal.push({
        index: i,
        time: p.t,
        values: { ...cumulativeCounts }
      });
      chartHistoryTerritory.push({
        index: i,
        time: p.t,
        values: { ...currentTerritory }
      });
      chartHistoryColors.push({
        index: i,
        time: p.t,
        values: { ...cumulativeColors }
      });
      chartHistoryLiveColors.push({
        index: i,
        time: p.t,
        values: { ...currentLiveColors }
      });
    }
  }

  renderBattleLegend();
  renderBattleChart();
}

function getActiveSeries() {
  if (activeTab === 'color') {
    return {
      history: chartHistoryColors,
      isColor: true,
      title: 'TOTAL PLACED BY COLOR'
    };
  } else if (activeTab === 'territory') {
    return {
      history: chartHistoryTerritory,
      isColor: false,
      title: 'TERRITORY CONTROL BATTLE'
    };
  } else if (activeTab === 'livecolor') {
    return {
      history: chartHistoryLiveColors,
      isColor: true,
      title: 'ACTIVE PIXELS ON CANVAS (COLOR)'
    };
  } else {
    return {
      history: chartHistoryTotal,
      isColor: false,
      title: 'TOTAL PLACED OVER TIME'
    };
  }
}

function getTopKeys(history, count = 8) {
  if (!history || history.length === 0) return [];
  const lastPoint = history[history.length - 1];
  const keys = Object.keys(lastPoint.values || {});
  keys.sort((a, b) => (lastPoint.values[b] || 0) - (lastPoint.values[a] || 0));
  return keys.slice(0, count);
}

function renderBattleLegend() {
  if (!battleLegend) return;
  battleLegend.innerHTML = '';
  const { history, isColor } = getActiveSeries();
  const topKeys = getTopKeys(history, 8);

  topKeys.forEach(k => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const color = getItemColor(k, isColor);
    item.innerHTML = `
      <div class="legend-swatch" style="background-color: ${color}"></div>
      <div class="legend-name" title="${k}">${k}</div>
      <div class="legend-val" id="legend-val-${userClean(k)}">0</div>
    `;
    battleLegend.appendChild(item);
  });
}

function renderBattleChart(customCtx = null, width = 0, height = 0, opts = { updateDom: true }) {
  const targetCtx = customCtx || chartCtx;
  const targetCanvas = customCtx ? null : chartCanvas;
  const targetW = width || (targetCanvas ? targetCanvas.width : 340);
  const targetH = height || (targetCanvas ? targetCanvas.height : 220);

  if (targetCanvas && (targetCanvas.width !== targetCanvas.clientWidth || targetCanvas.height !== targetCanvas.clientHeight)) {
    targetCanvas.width = targetCanvas.clientWidth || 340;
    targetCanvas.height = targetCanvas.clientHeight || 220;
  }

  targetCtx.fillStyle = '#fbfbfa';
  targetCtx.fillRect(0, 0, targetW, targetH);

  const { history, isColor, title } = getActiveSeries();
  if (!history || history.length === 0) {
    targetCtx.fillStyle = '#94a3b8';
    targetCtx.font = '12px Special Elite, monospace';
    targetCtx.textAlign = 'center';
    targetCtx.fillText('No battle data available', targetW / 2, targetH / 2);
    return;
  }

  const padLeft = 45;
  const padRight = 15;
  const padTop = 26;
  const padBottom = 24;
  const plotW = targetW - padLeft - padRight;
  const plotH = targetH - padTop - padBottom;

  targetCtx.fillStyle = '#555555';
  targetCtx.font = 'bold 11px Architects Daughter, cursive';
  targetCtx.textAlign = 'left';
  targetCtx.fillText(title, padLeft, 16);

  targetCtx.strokeStyle = '#d1d0c9';
  targetCtx.lineWidth = 1;
  targetCtx.strokeRect(padLeft, padTop, plotW, plotH);

  const topKeys = getTopKeys(history, 8);
  const effectiveIdx = Math.min(currentIndex, pixels.length - 1);

  let activeMaxY = 10;
  for (let i = 0; i < history.length; i++) {
    const pt = history[i];
    if (pt.index > effectiveIdx) break;
    topKeys.forEach(k => {
      const v = pt.values[k] || 0;
      if (v > activeMaxY) activeMaxY = v;
    });
  }
  activeMaxY = Math.ceil(activeMaxY * 1.15);

  const activeMaxX = Math.max(1, pixels.length - 1);

  targetCtx.fillStyle = '#777777';
  targetCtx.font = '9px Special Elite, monospace';
  targetCtx.textAlign = 'right';
  targetCtx.fillText('0', padLeft - 6, padTop + plotH + 3);
  targetCtx.fillText(activeMaxY >= 1000 ? `${(activeMaxY / 1000).toFixed(1)}k` : `${activeMaxY}`, padLeft - 6, padTop + 9);

  const playerTipPositions = [];

  topKeys.forEach(key => {
    const color = getItemColor(key, isColor);
    const linePoints = [];
    let computedCurrentVal = 0;

    for (let i = 0; i < history.length; i++) {
      const pt = history[i];
      if (pt.index > effectiveIdx) {
        if (i > 0 && history[i - 1].index <= effectiveIdx) {
          const prev = history[i - 1];
          const span = pt.index - prev.index;
          const progress = span > 0 ? (effectiveIdx - prev.index) / span : 0;
          const prevVal = prev.values[key] || 0;
          computedCurrentVal = Math.round(prevVal + ((pt.values[key] || 0) - prevVal) * progress);
          const curY = padTop + plotH - (computedCurrentVal / activeMaxY) * plotH;
          linePoints.push({ x: padLeft + (effectiveIdx / activeMaxX) * plotW, y: curY });
        }
        break;
      }

      const x = padLeft + (pt.index / activeMaxX) * plotW;
      const val = pt.values[key] || 0;
      const y = padTop + plotH - (val / activeMaxY) * plotH;
      linePoints.push({ x, y });
      computedCurrentVal = val;
    }

    if (linePoints.length > 0) {
      targetCtx.save();
      targetCtx.strokeStyle = color;
      targetCtx.lineWidth = 2;
      targetCtx.beginPath();
      targetCtx.moveTo(linePoints[0].x, linePoints[0].y);
      for (let i = 1; i < linePoints.length; i++) {
        targetCtx.lineTo(linePoints[i].x, linePoints[i].y);
      }
      targetCtx.stroke();
      targetCtx.restore();

      const lastPt = linePoints[linePoints.length - 1];
      playerTipPositions.push({
        key,
        val: computedCurrentVal,
        color,
        x: lastPt.x,
        y: lastPt.y
      });
    }

    if (opts.updateDom) {
      const valEl = document.getElementById(`legend-val-${userClean(key)}`);
      if (valEl) {
        valEl.textContent = computedCurrentVal.toLocaleString();
      }
    }
  });

  playerTipPositions.sort((a, b) => a.y - b.y);
  for (let i = 1; i < playerTipPositions.length; i++) {
    if (playerTipPositions[i].y - playerTipPositions[i - 1].y < 12) {
      playerTipPositions[i].y = playerTipPositions[i - 1].y + 12;
    }
  }

  playerTipPositions.forEach(p => {
    targetCtx.fillStyle = p.color;
    targetCtx.beginPath();
    targetCtx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    targetCtx.fill();
  });
}

function updateStats() {
  timelineSlider.value = currentIndex;
  if (statProgress) statProgress.textContent = `${currentIndex.toLocaleString()} / ${pixels.length.toLocaleString()}`;
  if (pixels.length > 0 && currentIndex > 0) {
    const p = pixels[Math.min(currentIndex, pixels.length - 1)];
    const dateStr = new Date(p.t).toLocaleString();
    if (statTime) statTime.textContent = dateStr;
    if (playbackTimeLabel) playbackTimeLabel.textContent = dateStr;
  }
}

function updateLeaderboard() {
  if (!leaderboardList) return;
  const sorted = Object.entries(userCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  leaderboardList.innerHTML = '';
  sorted.forEach(([user, count], index) => {
    const row = document.createElement('div');
    row.className = 'leaderboard-row';
    row.innerHTML = `
      <span class="leaderboard-rank">#${index + 1}</span>
      <span class="leaderboard-user" title="${user}">${user}</span>
      <span class="leaderboard-count">${count.toLocaleString()}</span>
    `;
    leaderboardList.appendChild(row);
  });
}

function redrawCanvas() {
  ctx.fillStyle = '#EADDC9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  userCounts = {};

  const targetIdx = Math.min(currentIndex, pixels.length);
  for (let i = 0; i < targetIdx; i++) {
    const p = pixels[i];
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x, p.y, 1, 1);
    if (!isIgnoredPlacement(p.u, p.c)) {
      const u = p.u || 'anonymous';
      userCounts[u] = (userCounts[u] || 0) + 1;
    }
  }

  updateStats();
  updateLeaderboard();
  renderBattleChart();
}

function drawNextPixels() {
  if (!isPlaying || pixels.length === 0) return;

  const start = currentIndex;
  const end = Math.min(currentIndex + speed, pixels.length);

  for (let i = start; i < end; i++) {
    const p = pixels[i];
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x, p.y, 1, 1);

    if (!isIgnoredPlacement(p.u, p.c)) {
      const u = p.u || 'anonymous';
      userCounts[u] = (userCounts[u] || 0) + 1;
    }
  }

  currentIndex = end;
  updateStats();

  const now = Date.now();
  if (now - lastLeaderboardUpdate > 250) {
    updateLeaderboard();
    lastLeaderboardUpdate = now;
  }

  if (now - lastChartUpdate > 80) {
    renderBattleChart();
    lastChartUpdate = now;
  }

  if (currentIndex >= pixels.length) {
    isPlaying = false;
    playBtn.textContent = 'Play';
    updateLeaderboard();
    renderBattleChart();
    if (isRecording) {
      stopRecording();
    }
  } else {
    animationFrameId = requestAnimationFrame(drawNextPixels);
  }
}

playBtn.addEventListener('click', () => {
  if (pixels.length === 0) return;
  if (isPlaying) {
    isPlaying = false;
    playBtn.textContent = 'Play';
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
  } else {
    if (currentIndex >= pixels.length) {
      currentIndex = 0;
      redrawCanvas();
    }
    isPlaying = true;
    playBtn.textContent = 'Pause';
    animationFrameId = requestAnimationFrame(drawNextPixels);
  }
});

resetBtn.addEventListener('click', () => {
  isPlaying = false;
  playBtn.textContent = 'Play';
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  currentIndex = 0;
  redrawCanvas();
});

timelineSlider.addEventListener('input', (e) => {
  currentIndex = parseInt(e.target.value, 10);
  redrawCanvas();
});

speedInput.addEventListener('change', (e) => {
  const val = parseInt(e.target.value, 10);
  if (!isNaN(val) && val >= 1) {
    speed = val;
  }
});

function renderComboFrame() {
  if (!isRecording || !recorderCanvas) return;
  const rW = recorderCanvas.width;
  const rH = recorderCanvas.height;
  const mode = recordTargetSelect ? recordTargetSelect.value : 'combo';

  recorderCtx.fillStyle = '#f4f3ef';
  recorderCtx.fillRect(0, 0, rW, rH);

  if (mode === 'canvas') {
    recorderCtx.drawImage(canvas, 0, 0, rW, rH);
  } else if (mode === 'graph') {
    renderBattleChart(recorderCtx, rW, rH, { updateDom: false });
  } else {
    const leftW = Math.floor(rW * 0.58);
    const canvasRatio = canvas.width / canvas.height;
    let drawW = leftW - 40;
    let drawH = drawW / canvasRatio;
    if (drawH > rH - 40) {
      drawH = rH - 40;
      drawW = drawH * canvasRatio;
    }
    const drawX = 20 + (leftW - 40 - drawW) / 2;
    const drawY = 20 + (rH - 40 - drawH) / 2;

    recorderCtx.fillStyle = '#eaddc9';
    recorderCtx.fillRect(drawX, drawY, drawW, drawH);
    recorderCtx.imageSmoothingEnabled = false;
    recorderCtx.drawImage(canvas, drawX, drawY, drawW, drawH);
    recorderCtx.strokeStyle = '#2b2b2b';
    recorderCtx.lineWidth = 2;
    recorderCtx.strokeRect(drawX, drawY, drawW, drawH);

    const rightX = leftW + 10;
    const rightW = rW - rightX - 20;
    const chartH = Math.floor(rH * 0.52);

    renderBattleChart(recorderCtx, rightW, chartH, { updateDom: false });
  }

  recorderAnimId = requestAnimationFrame(renderComboFrame);
}

function startRecording() {
  recordedChunks = [];
  const mode = recordTargetSelect ? recordTargetSelect.value : 'combo';
  const quality = recordQualitySelect ? recordQualitySelect.value : 'medium';

  let targetWidth = 1280;
  let targetHeight = 720;
  let bps = 5000000;
  let fps = 30;

  if (quality === 'high') {
    targetWidth = 1920;
    targetHeight = 1080;
    bps = 10000000;
  } else if (quality === 'low') {
    targetWidth = 854;
    targetHeight = 480;
    bps = 2000000;
  }

  if (!recorderCanvas) {
    recorderCanvas = document.createElement('canvas');
    recorderCtx = recorderCanvas.getContext('2d');
  }
  recorderCanvas.width = targetWidth;
  recorderCanvas.height = targetHeight;

  let stream;
  try {
    stream = recorderCanvas.captureStream(fps);
  } catch (err) {
    alert('Video recording not supported in this browser environment: ' + err.message);
    return;
  }

  try {
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: bps
    });
  } catch {
    mediaRecorder = new MediaRecorder(stream, { videoBitsPerSecond: bps });
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    if (recorderAnimId) {
      cancelAnimationFrame(recorderAnimId);
      recorderAnimId = null;
    }
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `6b6tplace-timelapse-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  isRecording = true;
  recordBtn.textContent = 'Stop Recording';
  recordBtn.classList.remove('btn-danger');
  recordBtn.classList.add('btn-primary');

  currentIndex = 0;
  redrawCanvas();
  isPlaying = true;
  playBtn.textContent = 'Pause';
  mediaRecorder.start();
  renderComboFrame();
  animationFrameId = requestAnimationFrame(drawNextPixels);
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  recordBtn.textContent = 'Record Video';
  recordBtn.classList.remove('btn-primary');
  recordBtn.classList.add('btn-danger');
  if (recorderAnimId) {
    cancelAnimationFrame(recorderAnimId);
    recorderAnimId = null;
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

recordBtn.addEventListener('click', () => {
  if (pixels.length === 0) return;
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

async function loadData() {
  try {
    const res = await fetch('data/timelapse-data.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    pixels = await res.json();
    window.allPixels = pixels;
    if (window.onPixelsLoaded) window.onPixelsLoaded();

    let maxX = 0;
    let maxY = 0;
    pixels.forEach(p => {
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });

    const w = Math.max(256, maxX + 1);
    const h = Math.max(256, maxY + 1);
    initCanvas(w, h);

    timelineSlider.max = pixels.length;
    if (statTotal) statTotal.textContent = pixels.length.toLocaleString();
    currentIndex = pixels.length;

    preprocessChartData();
    redrawCanvas();
  } catch (err) {
    console.error('Failed to load timelapse data:', err);
  }
}

window.addEventListener('resize', () => {
  renderBattleChart();
});

loadData();
