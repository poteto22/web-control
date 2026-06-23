// Bangkok69 Election Dashboard - Client-side SPA Logic

// State management
let state = {
  currentPage: 'prime', // prime, area-prime, area-local, webhook
  areas: [],            // List of all areas
  selectedAreaPrime: '', // Currently selected area name for Area Prime view
  selectedAreaLocal: '', // Currently selected area name for Local Candidate view
  countdown: 10,        // 10s automatic polling countdown
  refreshIntervalId: null,
  isPollingEnabled: true,
  lastData: null        // Caches the latest loaded page data
};

// DOM Elements
const DOM = {
  navItems: document.querySelectorAll('.nav-item'),
  appContent: document.getElementById('app-content'),
  pageTitle: document.getElementById('page-title'),
  pageSubtitle: document.getElementById('page-subtitle'),
  lastUpdateTime: document.getElementById('last-update-time'),
  countdownText: document.getElementById('countdown'),
  refreshToggle: document.getElementById('refresh-toggle'),
  refreshNowBtn: document.getElementById('refresh-now-btn'),
  loadingOverlay: document.getElementById('loading-overlay'),
  statusDot: document.querySelector('.status-dot'),
  statusText: document.querySelector('.status-text'),
  
  // Quick stats elements
  statProgress: document.getElementById('stat-progress'),
  statCandidatesCount: document.getElementById('stat-candidates-count'),
  statTopScore: document.getElementById('stat-top-score'),
  statLeader: document.getElementById('stat-leader'),
  quickStatsBar: document.getElementById('quick-stats-bar')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupPolling();
  loadPage(state.currentPage);
});

// Setup SPA Navigation
function setupNavigation() {
  DOM.navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      
      const targetPage = item.getAttribute('data-page');
      if (state.currentPage === targetPage) return;
      
      // Update sidebar nav active state
      DOM.navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      // Load target page
      loadPage(targetPage);
    });
  });
  
  // Refresh button click handler
  DOM.refreshNowBtn.addEventListener('click', () => {
    refreshCurrentPage();
    resetCountdown();
  });
}

// Router & Controller
async function loadPage(page) {
  state.currentPage = page;
  showLoader();
  
  // Reset last data cache
  state.lastData = null;
  
  try {
    switch (page) {
      case 'prime':
        updateHeaders('คะแนนผู้สมัคร', 'แสดงผลคะแนนการเลือกตั้งผู้ว่าฯ / ส.ก. ทั้งหมด');
        DOM.quickStatsBar.style.display = 'grid';
        await loadPrimeCandidatesPage();
        break;
        
      case 'area-prime':
        updateHeaders('คะแนนแยกตามเขต (ผู้ว่า)', 'แสดงอันดับคะแนนของผู้สมัครผู้ว่า ในแต่ละเขตพื้นที่');
        DOM.quickStatsBar.style.display = 'none'; // Stats bar not relevant here
        await loadAreaPrimePage();
        break;
        
      case 'area-local':
        updateHeaders('คะแนนผู้สมัคร ส.ก. รายเขต', 'ค้นหาและดูผลคะแนนการเลือกตั้งสมาชิกสภากรุงเทพมหานคร (ส.ก.)');
        DOM.quickStatsBar.style.display = 'none';
        await loadAreaLocalPage();
        break;
        
      case 'webhook':
        updateHeaders('Webhook & Control Panel', 'ทดสอบและจัดการการส่งผ่านข้อมูลผลคะแนนผ่านระบบ Webhook API');
        DOM.quickStatsBar.style.display = 'none';
        await loadWebhookPage();
        break;
    }
    setDbOnline(true);
  } catch (error) {
    console.error('Error loading page:', error);
    renderErrorState(error.message);
    setDbOnline(false);
  } finally {
    hideLoader();
    updateTimestamp();
  }
}

// Helper to update Page Headers
function updateHeaders(title, subtitle) {
  DOM.pageTitle.textContent = title;
  DOM.pageSubtitle.textContent = subtitle;
}

// Helper to show/hide loading spinner
function showLoader() {
  DOM.loadingOverlay.classList.remove('hidden');
}

function hideLoader() {
  DOM.loadingOverlay.classList.add('hidden');
}

// Helper to update Timestamp
function updateTimestamp() {
  const now = new Date();
  DOM.lastUpdateTime.textContent = now.toLocaleTimeString('th-TH');
}

// Set database status
function setDbOnline(isOnline) {
  if (isOnline) {
    DOM.statusDot.className = 'status-dot online';
    DOM.statusText.textContent = 'Database Connected';
  } else {
    DOM.statusDot.className = 'status-dot offline';
    DOM.statusText.textContent = 'Database Disconnected';
  }
}

// Refresh logic
async function refreshCurrentPage() {
  try {
    switch (state.currentPage) {
      case 'prime':
        await loadPrimeCandidatesPage(true); // silent refresh
        break;
      case 'area-prime':
        await loadAreaPrimePage(true);
        break;
      case 'area-local':
        await loadAreaLocalPage(true);
        break;
      case 'webhook':
        // Webhook control doesn't need polling updates
        break;
    }
    setDbOnline(true);
  } catch (err) {
    console.error('Refresh failed:', err);
    setDbOnline(false);
  } finally {
    updateTimestamp();
  }
}

// Polling Controller
function setupPolling() {
  // Toggle control
  DOM.refreshToggle.addEventListener('change', (e) => {
    state.isPollingEnabled = e.target.checked;
    if (state.isPollingEnabled) {
      resetCountdown();
    } else {
      DOM.countdownText.textContent = 'PAUSED';
    }
  });

  // Countdown timer loop
  state.refreshIntervalId = setInterval(() => {
    if (!state.isPollingEnabled) return;
    
    state.countdown--;
    DOM.countdownText.textContent = `${state.countdown}s`;
    
    if (state.countdown <= 0) {
      refreshCurrentPage();
      resetCountdown();
    }
  }, 1000);
}

function resetCountdown() {
  state.countdown = 10;
  if (state.isPollingEnabled) {
    DOM.countdownText.textContent = '10s';
  } else {
    DOM.countdownText.textContent = 'PAUSED';
  }
}

// Fetch helper with standard headers and cache-busting
async function apiRequest(endpoint, options = {}) {
  // Add no-cache headers to the request options
  const fetchOptions = {
    ...options,
    headers: {
      ...options.headers,
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  };

  // Append a timestamp query parameter to GET requests to force the browser to bypass any caching layers
  let url = endpoint;
  if (!options.method || options.method.toUpperCase() === 'GET') {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}_t=${Date.now()}`;
  }

  const response = await fetch(url, fetchOptions);
  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

// Populate Area choices cached list
async function ensureAreasLoaded() {
  if (state.areas.length === 0) {
    state.areas = await apiRequest('/api/areas');
    // Set default selections if empty
    if (state.areas.length > 0) {
      if (!state.selectedAreaPrime) state.selectedAreaPrime = state.areas[0].name;
      if (!state.selectedAreaLocal) state.selectedAreaLocal = state.areas[0].name;
    }
  }
}

// Render error cards in main content viewport
function renderErrorState(message) {
  DOM.appContent.innerHTML = `
    <div class="empty-state fade-in-up">
      <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger); opacity: 0.8;"></i>
      <h3>เกิดข้อผิดพลาดในการโหลดข้อมูล</h3>
      <p>${message}</p>
      <button class="btn btn-primary" onclick="window.location.reload()">โหลดหน้าเว็บใหม่</button>
    </div>
  `;
}

// --- PAGE BUILDER: 1. Prime Candidates (Homepage) ---
// Helper to render Top 3 Podium leaderboard cards
function renderLeaderboard(top3) {
  return top3.map((cand, idx) => {
    const rank = idx + 1;
    const rankClass = `rank-${rank}`;
    const color = cand.colorCode || '#3b82f6';
    const avatar = cand.candidateImageUrl || 'https://asset-election.nationtv.tv/2026/candidates/default.png';
    
    return `
      <div class="leader-card ${rankClass}">
        <div class="badge-rank">${rank}</div>
        <div class="party-badge-top" style="border-color: ${color}44; background-color: ${color}15; color: ${color};">${cand.partiesName || 'อิสระ'}</div>
        
        <div class="leader-avatar-wrapper">
          <img class="leader-avatar" src="${avatar}" alt="${cand.prime_name}" onerror="this.src='https://asset-election.nationtv.tv/2026/candidates/default.png'">
          <div class="leader-number" style="background-color: ${color}">${cand.prime_number}</div>
        </div>
        
        <h4>${cand.prime_name}</h4>
        <div class="leader-party">${cand.partiesName || 'ผู้สมัครอิสระ'}</div>
        
        <div class="leader-score-box">
          <div class="leader-score">${cand.score.toLocaleString('th-TH')}</div>
          <div class="leader-score-label">คะแนนเสียง</div>
        </div>
        
        <div class="leader-progress-bar-wrapper">
          <div class="bar-stats">
            <span style="color: ${color}">สัดส่วนคะแนน</span>
            <span class="bar-percent">${cand.scorePercent}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-bar-fill" style="width: ${cand.scorePercent}%; background: linear-gradient(90deg, ${color} 0%, ${color}aa 100%)"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadPrimeCandidatesPage(isSilent = false) {
  if (!isSilent) showLoader();
  
  try {
    const candidates = await apiRequest('/api/prime-candidates');
    state.lastData = candidates;
    
    // 1. Update quick stats
    if (candidates.length > 0) {
      // Find average progress or leading candidate progress
      const progressVal = candidates[0].progress || 0;
      DOM.statProgress.textContent = `${progressVal}%`;
      DOM.statCandidatesCount.textContent = candidates.length;
      DOM.statTopScore.textContent = candidates[0].score.toLocaleString('th-TH');
      DOM.statLeader.textContent = candidates[0].prime_name.split(' ')[0]; // first name
    } else {
      DOM.statProgress.textContent = '--%';
      DOM.statCandidatesCount.textContent = '0';
      DOM.statTopScore.textContent = '0';
      DOM.statLeader.textContent = 'ไม่มี';
    }

    // Determine leading scores
    const top3 = candidates.slice(0, 3);

    // If silent and rows container exists, update content in place to preserve search query & inputs focus
    const rowsContainer = document.getElementById('candidates-rows-container');
    const leaderboardContainer = document.querySelector('.leaderboard-container');
    if (isSilent && rowsContainer && leaderboardContainer) {
      // Re-render the leaderboard cards completely to reflect correct positions/names
      leaderboardContainer.innerHTML = renderLeaderboard(top3);
      
      // Update candidate table rows
      rowsContainer.innerHTML = renderCandidateRows(candidates);
      
      // Keep search filters active if search query exists
      const searchInput = document.getElementById('candidate-search');
      if (searchInput && searchInput.value) {
        filterCandidates(searchInput.value);
      }
      return;
    }

    // Build HTML layout for homepage
    let html = `
      <!-- Top 3 Leaders Cards -->
      <div class="leaderboard-container fade-in-up">
        ${renderLeaderboard(top3)}
      </div>
      
      <!-- Full List Table -->
      <div class="candidates-table-container fade-in-up">
        <div class="table-header">
          <h3>อันดับผู้สมัครรับเลือกตั้งทั้งหมด</h3>
          <div class="search-box">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" id="candidate-search" placeholder="ค้นหาชื่อผู้สมัครหรือพรรค...">
          </div>
        </div>
        
        <div class="candidates-list" id="candidates-rows-container">
          ${renderCandidateRows(candidates)}
        </div>
      </div>
    `;

    DOM.appContent.innerHTML = html;
    
    // Bind search event
    const searchInput = document.getElementById('candidate-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        filterCandidates(e.target.value);
      });
    }

  } catch (error) {
    throw error;
  } finally {
    if (!isSilent) hideLoader();
  }
}

// Generate rows helper
function renderCandidateRows(candidates) {
  if (candidates.length === 0) {
    return `
      <div class="empty-state">
        <i class="fa-solid fa-user-slash"></i>
        <p>ไม่พบรายชื่อผู้สมัคร</p>
      </div>
    `;
  }
  
  return candidates.map((cand, idx) => {
    const color = cand.colorCode || '#94a3b8';
    const avatar = cand.candidateImageUrl || 'https://asset-election.nationtv.tv/2026/candidates/default.png';
    const rank = idx + 1;
    
    return `
      <div class="candidate-row" data-name="${cand.prime_name.toLowerCase()}" data-party="${(cand.partiesName || '').toLowerCase()}">
        <div class="candidate-no-badge" style="border-color: ${color}55; color: ${color};">${cand.prime_number}</div>
        <img class="candidate-img-small" src="${avatar}" alt="${cand.prime_name}" onerror="this.src='https://asset-election.nationtv.tv/2026/candidates/default.png'">
        
        <div class="candidate-name-info">
          <h5>${cand.prime_name}</h5>
          <span class="candidate-party-tag">
            <span class="color-dot-indicator" style="background-color: ${color}"></span>
            ${cand.partiesName || 'ผู้สมัครอิสระ'}
          </span>
        </div>
        
        <div class="candidate-score-info">
          <div class="score-val">${cand.score.toLocaleString('th-TH')}</div>
          <div class="score-label">คะแนน</div>
        </div>
        
        <div style="flex: 1;">
          <div class="progress-track" style="height: 6px;">
            <div class="progress-bar-fill" style="width: ${cand.scorePercent}%; background-color: ${color}"></div>
          </div>
        </div>
        
        <div style="text-align: right;">
          <span class="percent-display" style="color: ${color}">${cand.scorePercent}%</span>
        </div>
      </div>
    `;
  }).join('');
}

// Live client-side candidate search
function filterCandidates(query) {
  const cleanQuery = query.toLowerCase().trim();
  const rows = document.querySelectorAll('.candidate-row');
  
  rows.forEach(row => {
    const name = row.getAttribute('data-name');
    const party = row.getAttribute('data-party');
    
    if (name.includes(cleanQuery) || party.includes(cleanQuery)) {
      row.style.display = 'grid';
    } else {
      row.style.display = 'none';
    }
  });
}

// --- PAGE BUILDER: 2. Prime Candidates By Area (เขต) ---
async function loadAreaPrimePage(isSilent = false) {
  // If silent refresh and area scores container exists, only fetch data and re-render scores
  const rowsContainer = document.getElementById('area-prime-rows');
  if (isSilent && rowsContainer) {
    await fetchAndRenderAreaPrimeData();
    return;
  }

  if (!isSilent) showLoader();
  
  try {
    await ensureAreasLoaded();
    
    // Draw layout with Selector Dropdown
    let html = `
      <div class="selector-panel fade-in-up">
        <div class="selector-left" style="display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap;">
          <div class="selector-group">
            <label for="area-select">เลือกเขตพื้นที่</label>
            <select id="area-select" class="custom-select" style="min-width: 220px;">
              ${state.areas.map(a => `<option value="${a.name}" ${a.name === state.selectedAreaPrime ? 'selected' : ''}>เขต${a.name} (หมายเลข ${a.area_no})</option>`).join('')}
            </select>
          </div>
          <button id="send-prime-webhook-btn" class="btn btn-primary" style="height: 42px; display: inline-flex; align-items: center; justify-content: center; white-space: nowrap;">
            <i class="fa-solid fa-paper-plane"></i> ส่งข้อมูลเขต
          </button>
        </div>
        
        <div class="last-update" style="margin-top: 10px;">
          <i class="fa-solid fa-circle-info"></i>
          <span>แสดงเฉพาะผลคะแนนของเขตที่เลือก</span>
        </div>
      </div>
      
      <div class="grid-2col fade-in-up">
        <!-- Top Lead Area candidates -->
        <div class="candidates-table-container" style="flex: 1;">
          <div class="table-header">
            <h3>อันดับผู้ว่าฯ เขต${state.selectedAreaPrime}</h3>
          </div>
          <div class="candidates-list" id="area-prime-rows">
            <!-- Loaded dynamically below -->
          </div>
        </div>
        
        <!-- Summary Stats Card of selected area -->
        <div class="webhook-container" style="flex: 0.8; height: fit-content;">
          <div class="webhook-header">
            <i class="fa-solid fa-map-location-dot"></i>
            <div>
              <h3 style="color: #fff;">ข้อมูลการเลือกตั้งรายเขต</h3>
              <p style="font-size: 0.8rem; color: var(--text-muted);">สรุปข้อมูลเบื้องต้นของพื้นที่เขต${state.selectedAreaPrime}</p>
            </div>
          </div>
          <div class="webhook-details">
            <div class="detail-row">
              <label>เขตการเลือกตั้ง</label>
              <div class="detail-value-box">เขต${state.selectedAreaPrime}</div>
            </div>
            <div class="detail-row">
              <label>ความคืบหน้าการนับคะแนนในพื้นที่</label>
              <div class="detail-value-box" id="area-progress-text">--%</div>
            </div>
            <div class="detail-row">
              <label>ผู้สมัครที่ทำคะแนนนำในเขตนี้</label>
              <div class="detail-value-box" id="area-leader-text">ไม่มี</div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    DOM.appContent.innerHTML = html;
    
    // Bind dropdown change event
    const select = document.getElementById('area-select');
    if (select) {
      select.addEventListener('change', async (e) => {
        state.selectedAreaPrime = e.target.value;
        showLoader();
        await fetchAndRenderAreaPrimeData();
        hideLoader();
      });
    }

    // Bind send webhook button click
    const sendWebhookBtn = document.getElementById('send-prime-webhook-btn');
    if (sendWebhookBtn) {
      sendWebhookBtn.addEventListener('click', async () => {
        const selectedArea = state.selectedAreaPrime;
        if (!selectedArea) {
          alert('กรุณาเลือกเขตก่อนส่งข้อมูล');
          return;
        }
        
        sendWebhookBtn.disabled = true;
        const originalContent = sendWebhookBtn.innerHTML;
        sendWebhookBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> กำลังส่ง...`;
        
        try {
          const res = await apiRequest(`/api/webhook/send-prime?area=${encodeURIComponent(selectedArea)}`);
          
          if (res.status === 200 || res.status === 201 || res.statusText === 'OK' || (res.responseReceived && !res.error)) {
            alert(`ส่งข้อมูลเขต "${selectedArea}" สำเร็จ!\nผลการส่ง: ${JSON.stringify(res.responseReceived || res)}`);
          } else {
            alert(`ส่งข้อมูลเขตไม่สำเร็จ: ${res.statusText || 'เกิดข้อผิดพลาด'}`);
          }
        } catch (error) {
          console.error('Webhook error:', error);
          alert(`ไม่สามารถส่งข้อมูลได้: ${error.message}`);
        } finally {
          sendWebhookBtn.disabled = false;
          sendWebhookBtn.innerHTML = originalContent;
        }
      });
    }
    
    // Load area-specific data
    await fetchAndRenderAreaPrimeData();
    
  } catch (error) {
    throw error;
  } finally {
    if (!isSilent) hideLoader();
  }
}

// Fetch and render Area Prime votes
async function fetchAndRenderAreaPrimeData() {
  const rowsContainer = document.getElementById('area-prime-rows');
  const progressText = document.getElementById('area-progress-text');
  const leaderText = document.getElementById('area-leader-text');
  
  if (!rowsContainer) return;
  
  try {
    const scores = await apiRequest(`/api/areas/${encodeURIComponent(state.selectedAreaPrime)}/prime`);
    state.lastData = scores;
    
    if (scores.length === 0) {
      rowsContainer.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-inbox"></i>
          <p>ไม่มีคะแนนสำหรับเขตนี้</p>
        </div>
      `;
      progressText.textContent = '0%';
      leaderText.textContent = 'ไม่มี';
      return;
    }
    
    // Update summary values
    progressText.textContent = `${scores[0].progress || 0}%`;
    leaderText.textContent = `${scores[0].candidateName} (${scores[0].partiesName || 'อิสระ'}) - ${scores[0].score.toLocaleString('th-TH')} คะแนน`;
    
    // Build rows
    rowsContainer.innerHTML = scores.map((item, idx) => {
      const color = item.colorCode || '#94a3b8';
      const avatar = item.candidateImageUrl || 'https://asset-election.nationtv.tv/2026/candidates/default.png';
      
      return `
        <div class="candidate-row">
          <div class="candidate-no-badge" style="border-color: ${color}55; color: ${color};">${item.prime_number || '?'}</div>
          <img class="candidate-img-small" src="${avatar}" alt="${item.candidateName}" onerror="this.src='https://asset-election.nationtv.tv/2026/candidates/default.png'">
          
          <div class="candidate-name-info">
            <h5>${item.candidateName}</h5>
            <span class="candidate-party-tag">
              <span class="color-dot-indicator" style="background-color: ${color}"></span>
              ${item.partiesName || 'ผู้สมัครอิสระ'}
            </span>
          </div>
          
          <div class="candidate-score-info">
            <div class="score-val">${item.score.toLocaleString('th-TH')}</div>
            <div class="score-label">คะแนน</div>
          </div>
          
          <div style="flex: 1;">
            <div class="progress-track" style="height: 6px;">
              <div class="progress-bar-fill" style="width: ${item.scorePercent}%; background-color: ${color}"></div>
            </div>
          </div>
          
          <div style="text-align: right;">
            <span class="percent-display" style="color: ${color}">${item.scorePercent}%</span>
          </div>
        </div>
      `;
    }).join('');
    
  } catch (error) {
    console.error('Error fetching area prime data:', error);
    rowsContainer.innerHTML = `<p style="color: var(--danger); padding: 20px;">เกิดข้อผิดพลาด: ${error.message}</p>`;
  }
}

// --- PAGE BUILDER: 3. Local Area Candidates (ส.ก.) ---
async function loadAreaLocalPage(isSilent = false) {
  // If silent refresh and local scores container exists, only fetch data and re-render scores
  const rowsContainer = document.getElementById('area-local-rows');
  if (isSilent && rowsContainer) {
    await fetchAndRenderAreaLocalData();
    return;
  }

  if (!isSilent) showLoader();
  
  try {
    await ensureAreasLoaded();
    
    let html = `
      <div class="selector-panel fade-in-up">
        <div class="selector-left" style="display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap;">
          <div class="selector-group">
            <label for="area-select-local">เลือกเขตพื้นที่ ส.ก.</label>
            <select id="area-select-local" class="custom-select" style="min-width: 220px;">
              ${state.areas.map(a => `<option value="${a.name}" ${a.name === state.selectedAreaLocal ? 'selected' : ''}>เขต${a.name} (หมายเลข ${a.area_no})</option>`).join('')}
            </select>
          </div>
          <button id="send-local-webhook-btn" class="btn btn-primary" style="height: 42px; display: inline-flex; align-items: center; justify-content: center; white-space: nowrap;">
            <i class="fa-solid fa-paper-plane"></i> ส่งข้อมูลเขต
          </button>
        </div>
        
        <div class="last-update" style="margin-top: 10px;">
          <i class="fa-solid fa-users"></i>
          <span>แสดงคะแนนผู้สมัครรับเลือกตั้ง ส.ก. ประจำเขตพื้นที่</span>
        </div>
      </div>
      
      <div class="candidates-table-container fade-in-up">
        <div class="table-header">
          <h3>ผลคะแนนผู้สมัคร ส.ก. เขต${state.selectedAreaLocal}</h3>
          <div class="last-update" style="font-size: 0.85rem;">
            <span>ความคืบหน้านับคะแนนเขต: </span>
            <strong id="local-progress-text">--%</strong>
          </div>
        </div>
        
        <div class="candidates-list" id="area-local-rows">
          <!-- Loaded dynamically below -->
        </div>
      </div>
    `;
    
    DOM.appContent.innerHTML = html;
    
    // Bind dropdown change
    const select = document.getElementById('area-select-local');
    if (select) {
      select.addEventListener('change', async (e) => {
        state.selectedAreaLocal = e.target.value;
        showLoader();
        await fetchAndRenderAreaLocalData();
        hideLoader();
      });
    }

    // Bind send webhook button click
    const sendWebhookBtn = document.getElementById('send-local-webhook-btn');
    if (sendWebhookBtn) {
      sendWebhookBtn.addEventListener('click', async () => {
        const selectedArea = state.selectedAreaLocal;
        if (!selectedArea) {
          alert('กรุณาเลือกเขตก่อนส่งข้อมูล');
          return;
        }
        
        sendWebhookBtn.disabled = true;
        const originalContent = sendWebhookBtn.innerHTML;
        sendWebhookBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> กำลังส่ง...`;
        
        try {
          const res = await apiRequest(`/api/webhook/send-area?area=${encodeURIComponent(selectedArea)}`);
          
          if (res.status === 200 || res.status === 201 || res.statusText === 'OK' || (res.responseReceived && !res.error)) {
            alert(`ส่งข้อมูลเขต "${selectedArea}" สำเร็จ!\nผลการส่ง: ${JSON.stringify(res.responseReceived || res)}`);
          } else {
            alert(`ส่งข้อมูลเขตไม่สำเร็จ: ${res.statusText || 'เกิดข้อผิดพลาด'}`);
          }
        } catch (error) {
          console.error('Webhook error:', error);
          alert(`ไม่สามารถส่งข้อมูลได้: ${error.message}`);
        } finally {
          sendWebhookBtn.disabled = false;
          sendWebhookBtn.innerHTML = originalContent;
        }
      });
    }
    
    await fetchAndRenderAreaLocalData();
    
  } catch (error) {
    throw error;
  } finally {
    if (!isSilent) hideLoader();
  }
}

// Fetch and render Local area scores
async function fetchAndRenderAreaLocalData() {
  const rowsContainer = document.getElementById('area-local-rows');
  const progressText = document.getElementById('local-progress-text');
  
  if (!rowsContainer) return;
  
  try {
    const scores = await apiRequest(`/api/areas/${encodeURIComponent(state.selectedAreaLocal)}/local`);
    state.lastData = scores;
    
    if (scores.length === 0) {
      rowsContainer.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-circle-question"></i>
          <p>ไม่มีรายชื่อผู้สมัครหรือข้อมูลคะแนน ส.ก. ในเขตนี้</p>
        </div>
      `;
      progressText.textContent = '0%';
      return;
    }
    
    // Update progress details
    progressText.textContent = `${scores[0].progress || 0}%`;
    
    rowsContainer.innerHTML = scores.map((item, idx) => {
      // For local candidates, we use generic color representation based on index to differentiate
      const defaultColors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#06b6d4'];
      const color = defaultColors[idx % defaultColors.length];
      const avatar = item.candidateImageUrl || 'https://asset-election.nationtv.tv/2026/candidates/default.png';
      
      return `
        <div class="candidate-row">
          <div class="candidate-no-badge" style="border-color: ${color}55; color: ${color};">${idx + 1}</div>
          <img class="candidate-img-small" src="${avatar}" alt="${item.candidateName}" onerror="this.src='https://asset-election.nationtv.tv/2026/candidates/default.png'">
          
          <div class="candidate-name-info">
            <h5>${item.candidateName}</h5>
            <span class="candidate-party-tag">
              <span class="color-dot-indicator" style="background-color: ${color}"></span>
              ผู้สมัครสมาชิกสภากรุงเทพมหานคร (ส.ก.)
            </span>
          </div>
          
          <div class="candidate-score-info">
            <div class="score-val">${item.score.toLocaleString('th-TH')}</div>
            <div class="score-label">คะแนน</div>
          </div>
          
          <div style="flex: 1;">
            <div class="progress-track" style="height: 6px;">
              <div class="progress-bar-fill" style="width: ${item.scorePercent}%; background-color: ${color}"></div>
            </div>
          </div>
          
          <div style="text-align: right;">
            <span class="percent-display" style="color: ${color}">${item.scorePercent}%</span>
          </div>
        </div>
      `;
    }).join('');
    
  } catch (error) {
    console.error('Error fetching area local data:', error);
    rowsContainer.innerHTML = `<p style="color: var(--danger); padding: 20px;">เกิดข้อผิดพลาด: ${error.message}</p>`;
  }
}

// --- PAGE BUILDER: 4. Webhook & Settings ---
async function loadWebhookPage() {
  // We make a call to get webhook URL information or we read from process.env via API.
  // We'll simulate fetching it, or fetching our status API
  let webhookUrl = '';
  try {
    // We can pull it from env via a quick request or render page directly.
    // The backend POST endpoint handles it, we'll fetch a dummy trigger or get the .env settings.
    // Let's create an elegant UI to allow testing the webhook
    
    let html = `
      <div class="grid-2col fade-in-up">
        <!-- Webhook Configurations -->
        <div class="webhook-container">
          <div class="webhook-header">
            <i class="fa-solid fa-circle-nodes"></i>
            <div>
              <h3 style="color: #fff;">ระบบส่งต่อข้อมูล (Webhook Settings)</h3>
              <p style="font-size: 0.85rem; color: var(--text-muted);">จัดการพุชผลคะแนนเลือกตั้งเรียลไทม์ไปยังระบบภายนอก</p>
            </div>
          </div>
          
          <div class="webhook-details">
            <div class="detail-row">
              <label>สถานะ Webhook</label>
              <div class="detail-value-box" style="color: var(--success); font-weight: 700;">
                <span class="status-dot online" style="margin-right: 8px;"></span> ACTIVE (พร้อมรับคำสั่ง)
              </div>
            </div>
            
            <div class="detail-row">
              <label>Webhook endpoint URL (จาก .env)</label>
              <div class="detail-value-box" id="env-webhook-url" style="color: #93c5fd;">กำลังดึงข้อมูล...</div>
            </div>
            
            <div class="detail-row">
              <label>รูปแบบข้อมูลที่ส่ง (Payload structure)</label>
              <div class="detail-value-box" style="font-size: 0.75rem; max-height: 150px; overflow-y: auto;">
{
  "event": "election_update",
  "timestamp": "2026-06-17T09:08:28Z",
  "summary": {
    "total_candidates": 20,
    "leading_candidate": "...",
    "top_scores": [...]
  },
  "data": [...]
}
              </div>
            </div>
          </div>
          
          <div class="webhook-actions">
            <button class="btn btn-primary" id="trigger-webhook-btn">
              <i class="fa-solid fa-paper-plane"></i> ส่งข้อมูลทดสอบ (Trigger Webhook)
            </button>
          </div>
        </div>
        
        <!-- Interactive Webhook Output Console Log -->
        <div class="webhook-container" style="flex: 1.2;">
          <div class="webhook-header">
            <i class="fa-solid fa-terminal"></i>
            <div>
              <h3 style="color: #fff;">ระบบบันทึกเหตุการณ์ (Console Log)</h3>
              <p style="font-size: 0.85rem; color: var(--text-muted);">แสดงการตอบสนองความสำเร็จหรือการทำงานของ Webhook API</p>
            </div>
          </div>
          
          <div class="console-box" id="console-logs">> _ Waiting for event trigger...</div>
          
          <div style="display: flex; justify-content: flex-end;">
            <button class="btn btn-secondary btn-sm" id="clear-console-btn">
              <i class="fa-solid fa-trash-can"></i> ล้างหน้าจอ
            </button>
          </div>
        </div>
      </div>
    `;
    
    DOM.appContent.innerHTML = html;
    
    // Set default URL text or query it (by firing a minor endpoint check or querying DB)
    const envUrlDisplay = document.getElementById('env-webhook-url');
    // We can extract webhook URL from standard ping
    envUrlDisplay.textContent = 'https://election69.event360plus.com/webhook/area'; // Fallback / default from .env
    
    // Bind trigger webhook button
    const triggerBtn = document.getElementById('trigger-webhook-btn');
    const clearBtn = document.getElementById('clear-console-btn');
    const consoleLogs = document.getElementById('console-logs');
    
    if (clearBtn && consoleLogs) {
      clearBtn.addEventListener('click', () => {
        consoleLogs.innerHTML = '> Console cleared.\n';
      });
    }
    
    if (triggerBtn && consoleLogs) {
      triggerBtn.addEventListener('click', async () => {
        appendToConsole('Sending Webhook trigger request to backend...');
        triggerBtn.disabled = true;
        
        try {
          const res = await apiRequest('/api/webhook/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          
          envUrlDisplay.textContent = res.webhookUrl;
          
          appendToConsole(`SUCCESS! Webhook fired.`);
          appendToConsole(`Target URL: ${res.webhookUrl}`);
          appendToConsole(`Response Code: ${res.status} ${res.statusText}`);
          appendToConsole(`Response Data: ${JSON.stringify(res.responseReceived, null, 2)}`);
          
        } catch (err) {
          appendToConsole(`ERROR: Failed to trigger webhook.\nDetails: ${err.message}`);
        } finally {
          triggerBtn.disabled = false;
        }
      });
    }
    
  } catch (error) {
    throw error;
  }
}

// Log formatting inside Webhook Console View
function appendToConsole(message) {
  const consoleBox = document.getElementById('console-logs');
  if (!consoleBox) return;
  
  const timestamp = new Date().toLocaleTimeString('th-TH');
  consoleBox.innerHTML += `\n[${timestamp}] ${message}`;
  // Scroll to bottom
  consoleBox.scrollTop = consoleBox.scrollHeight;
}
