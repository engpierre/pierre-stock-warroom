// Pierre Stock War Room Client Logic & Julie Reactive Core Engine
let currentPortfolio = null;
let activeFilter = 'all';
let searchQuery = '';
let activeScanState = {
  isScanning: false,
  clusterId: null,
  clusterName: null,
  tickers: [],
  startedAt: null
};
let scanTimerInterval = null;
let scanPollInterval = null;

// Speech and Audio Engine
let isVoiceMuted = false;
window.activeUtterances = new Set();
let speechRecognition = null;
let isRecording = false;

// Energy Orb State Engine
let orbState = 'idle'; // 'idle' | 'listening' | 'thinking' | 'speaking'
let orbAnimationId = null;
let orbAngle = 0;
let orbParticles = [];

const CLUSTER_COLORS = {
  1: '#0284c7', // Defense (Cobalt)
  2: '#f97316', // Energy (Orange)
  3: '#eab308', // Power (Yellow)
  4: '#10b981', // Healthcare (Emerald)
  5: '#84cc16', // Nuclear (Lime)
  6: '#8b5cf6', // Big Tech (Violet)
  7: '#ec4899', // Next-Gen (Pink)
  8: '#f59e0b'  // Crypto (Amber)
};

const CLUSTER_SHORT_NAMES = {
  1: 'Defense',
  2: 'Energy',
  3: 'Power Grid',
  4: 'Healthcare',
  5: 'Nuclear',
  6: 'Big Tech',
  7: 'Next-Gen',
  8: 'Crypto'
};

document.addEventListener('DOMContentLoaded', () => {
  initEvents();
  initJulieOrb();
  initSpeechRecognition();
  loadPortfolio();

  // 30s background poll for prices & passive sync
  setInterval(() => {
    if (!activeScanState.isScanning) {
      loadPortfolio(false);
    }
  }, 30000);
});

/* ========================================================
   EVENT LISTENERS & CONTROL WIRING
======================================================== */
/* ========================================================
   COMMAND DECK LIVE UTC CLOCK & PLUGIN TAB SWITCHER
======================================================== */
function initDeckLiveClock() {
  const clockEl = document.getElementById('deck-live-clock');
  if (!clockEl) return;
  function update() {
    const now = new Date();
    clockEl.textContent = now.toISOString().substring(11, 19) + ' UTC';
  }
  update();
  setInterval(update, 1000);
}

function initDeckPluginTabs() {
  const tabWarRoom = document.getElementById('tab-war-room');
  const tabOverview = document.getElementById('tab-overview');

  if (tabOverview) {
    tabOverview.addEventListener('click', () => {
      try {
        if (window.parent && window.parent.document && window.parent.document.getElementById('plugin-frame')) {
          window.parent.document.getElementById('plugin-frame').src = '/pages/overview';
          return;
        }
      } catch (e) {}
      window.location.href = '/pages/overview';
    });
  }

  if (tabWarRoom) {
    tabWarRoom.addEventListener('click', () => {
      try {
        if (window.parent && window.parent.document && window.parent.document.getElementById('plugin-frame')) {
          window.parent.document.getElementById('plugin-frame').src = '/pages/war-room';
          return;
        }
      } catch (e) {}
      window.location.href = '/pages/war-room';
    });
  }
}

function initEvents() {
  initDeckLiveClock();
  initDeckPluginTabs();
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('rotating');
      loadPortfolio(true).finally(() => {
        setTimeout(() => refreshBtn.classList.remove('rotating'), 600);
      });
    });
  }

  const zeroBtn = document.getElementById('zero-shares-btn');
  if (zeroBtn) {
    zeroBtn.addEventListener('click', async () => {
      if (confirm('Reset all 40 portfolio positions to 0 shares?')) {
        try {
          const res = await fetch('/api/plugins/war-room/reset-shares', { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            showToast('🧹 All 40 portfolio positions reset to 0 shares.');
            await loadPortfolio(true);
          }
        } catch (err) {
          console.error('Reset shares error:', err);
          showToast('Failed to reset shares.');
        }
      }
    });
  }

  const searchInput = document.getElementById('ticker-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderMatrix();
    });
  }

  const filterPills = document.querySelectorAll('.filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeFilter = pill.getAttribute('data-filter');
      renderMatrix();
    });
  });

  // Mute Toggle Button
  const muteBtn = document.getElementById('julie-mute-btn');
  const muteIcon = document.getElementById('mute-icon');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      isVoiceMuted = !isVoiceMuted;
      if (isVoiceMuted) {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        window.activeUtterances.clear();
        if (muteIcon) muteIcon.textContent = '🔇';
        muteBtn.title = 'Julie Voice Muted (Click to Unmute)';
        showToast('Julie voice output muted');
      } else {
        if (muteIcon) muteIcon.textContent = '🔊';
        muteBtn.title = 'Julie Voice Active (Click to Mute)';
        showToast('Julie voice output unmuted');
      }
    });
  }

  // Push to Talk Button
  const micBtn = document.getElementById('julie-mic-btn');
  if (micBtn) {
    micBtn.addEventListener('click', () => togglePushToTalk());
  }

  // Morning Flight Check Button
  const briefBtn = document.getElementById('julie-brief-btn');
  if (briefBtn) {
    briefBtn.addEventListener('click', () => triggerMorningBrief());
  }

  // Phase 9: Run GPU Forecast Button
  const forecastBtn = document.getElementById('julie-forecast-btn');
  if (forecastBtn) {
    forecastBtn.addEventListener('click', () => {
      if (typeof triggerGpuForecasts === 'function') {
        triggerGpuForecasts();
      } else {
        handleUserDirective('run gpu forecast');
      }
    });
  }
  // Cockpit Action Buttons: Risk Guard, Whale Scan, Rebalance
  const riskBtn = document.getElementById('julie-risk-btn');
  if (riskBtn) {
    riskBtn.addEventListener('click', () => {
      handleUserDirective('run risk guard audit');
    });
  }

  const whaleBtn = document.getElementById('julie-whale-btn');
  if (whaleBtn) {
    whaleBtn.addEventListener('click', () => {
      handleUserDirective('run whale scan');
    });
  }

  const rebalanceBtn = document.getElementById('julie-rebalance-btn');
  if (rebalanceBtn) {
    rebalanceBtn.addEventListener('click', () => {
      handleUserDirective('run portfolio rebalance check');
    });
  }


  // Phase 8: Dynamic Universe Add Ticker Modal Wiring
  const addTickerBtn = document.getElementById('add-ticker-btn');
  const addModal = document.getElementById('add-ticker-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');
  const modalSubmitBtn = document.getElementById('modal-submit-btn');
  const modalTickerInput = document.getElementById('modal-ticker-input');
  const modalClusterSelect = document.getElementById('modal-cluster-select');
  const modalSharesInput = document.getElementById('modal-shares-input');
  const modalError = document.getElementById('modal-error-msg');

  if (addTickerBtn && addModal) {
    addTickerBtn.addEventListener('click', () => {
      modalTickerInput.value = '';
      modalSharesInput.value = '0';
      if (modalError) modalError.classList.add('hidden');
      addModal.classList.remove('hidden');
      modalTickerInput.focus();
    });

    const closeModal = () => addModal.classList.add('hidden');
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
    if (modalCancelBtn) modalCancelBtn.addEventListener('click', closeModal);

    if (modalSubmitBtn) {
      modalSubmitBtn.addEventListener('click', async () => {
        const ticker = (modalTickerInput.value || '').trim().toUpperCase();
        const clusterId = parseInt(modalClusterSelect.value, 10);
        const shares = parseFloat(modalSharesInput.value) || 0;

        if (!ticker) {
          if (modalError) {
            modalError.textContent = 'Please enter a valid ticker symbol.';
            modalError.classList.remove('hidden');
          }
          return;
        }

        modalSubmitBtn.disabled = true;
        modalSubmitBtn.textContent = 'VALIDATING...';

        try {
          const res = await fetch('/api/plugins/war-room/universe/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker, cluster_id: clusterId, shares })
          });
          const data = await res.json();
          if (data.success) {
            closeModal();
            showToast(`➕ Added $${ticker} to ${data.asset.cluster_name}`);
            await loadPortfolio(true);
          } else {
            if (modalError) {
              modalError.textContent = data.error || 'Failed to add ticker.';
              modalError.classList.remove('hidden');
            }
          }
        } catch (err) {
          if (modalError) {
            modalError.textContent = 'Network error adding ticker.';
            modalError.classList.remove('hidden');
          }
        } finally {
          modalSubmitBtn.disabled = false;
          modalSubmitBtn.textContent = 'ADD TO UNIVERSE';
        }
      });
    }
  }

  // Dynamic Universe Remove Ticker Modal Wiring
  const removeTickerBtn = document.getElementById('remove-ticker-btn');
  const removeModal = document.getElementById('remove-ticker-modal');
  const removeCloseBtn = document.getElementById('remove-modal-close-btn');
  const removeCancelBtn = document.getElementById('remove-modal-cancel-btn');
  const removeSubmitBtn = document.getElementById('remove-modal-submit-btn');
  const removeTickerSelect = document.getElementById('remove-modal-ticker-select');
  const removeAssetInfo = document.getElementById('remove-modal-asset-info');
  const removeForceCheckbox = document.getElementById('remove-modal-force-checkbox');
  const removeError = document.getElementById('remove-modal-error-msg');

  if (removeTickerBtn && removeModal) {
    removeTickerBtn.addEventListener('click', () => {
      if (removeError) removeError.classList.add('hidden');
      if (removeAssetInfo) removeAssetInfo.classList.add('hidden');
      if (removeForceCheckbox) removeForceCheckbox.checked = false;

      // Populate dropdown from current portfolio assets
      removeTickerSelect.innerHTML = '<option value="" disabled selected>-- Select an asset to remove --</option>';
      const allAssets = (currentPortfolio && currentPortfolio.assets) ? [...currentPortfolio.assets] : [];
      allAssets.sort((a, b) => a.ticker.localeCompare(b.ticker));

      allAssets.forEach(asset => {
        const opt = document.createElement('option');
        opt.value = asset.ticker;
        const sharesText = asset.shares > 0 ? `${asset.shares} sh` : 'Watchlist';
        opt.textContent = `${asset.ticker} — ${asset.name || asset.ticker} [${asset.cluster_name || 'Cluster ' + asset.cluster_id}] (${sharesText})`;
        removeTickerSelect.appendChild(opt);
      });

      removeModal.classList.remove('hidden');
      removeTickerSelect.focus();
    });

    if (removeTickerSelect) {
      removeTickerSelect.addEventListener('change', () => {
        const selectedTicker = removeTickerSelect.value;
        const asset = (currentPortfolio && currentPortfolio.assets) ? currentPortfolio.assets.find(a => a.ticker === selectedTicker) : null;
        if (asset && removeAssetInfo) {
          const hasShares = (asset.shares || 0) > 0;
          removeAssetInfo.innerHTML = `
            <strong>${asset.ticker}</strong> (${asset.name || asset.ticker})<br/>
            Cluster: <em>${asset.cluster_name || 'Cluster ' + asset.cluster_id}</em><br/>
            Position: <strong>${asset.shares || 0} shares</strong> ($${(asset.position_value || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })})<br/>
            Spot Price: $${(asset.spot_price || 0).toFixed(2)} | Sentiment: ${asset.sentiment_regime || 'UNSCANNED'}
            ${hasShares ? '<br/><span style="color:#fb7185;font-weight:bold;">⚠️ Active shares detected. "Force remove" is enabled to zero out position.</span>' : ''}
          `;
          removeAssetInfo.classList.remove('hidden');
          if (hasShares && removeForceCheckbox) {
            removeForceCheckbox.checked = true;
          }
        } else if (removeAssetInfo) {
          removeAssetInfo.classList.add('hidden');
        }
      });
    }

    const closeRemoveModal = () => removeModal.classList.add('hidden');
    if (removeCloseBtn) removeCloseBtn.addEventListener('click', closeRemoveModal);
    if (removeCancelBtn) removeCancelBtn.addEventListener('click', closeRemoveModal);

    if (removeSubmitBtn) {
      removeSubmitBtn.addEventListener('click', async () => {
        const ticker = (removeTickerSelect.value || '').trim().toUpperCase();
        const force = removeForceCheckbox ? removeForceCheckbox.checked : false;

        if (!ticker) {
          if (removeError) {
            removeError.textContent = 'Please select a ticker to remove.';
            removeError.classList.remove('hidden');
          }
          return;
        }

        removeSubmitBtn.disabled = true;
        removeSubmitBtn.textContent = 'REMOVING...';

        try {
          const res = await fetch('/api/plugins/war-room/universe/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker, force })
          });
          const data = await res.json();
          if (data.success) {
            closeRemoveModal();
            showToast(`🗑️ Removed $${ticker} from universe`);
            await loadPortfolio(true);
          } else {
            if (removeError) {
              removeError.textContent = data.error || 'Failed to remove ticker.';
              removeError.classList.remove('hidden');
            }
          }
        } catch (err) {
          if (removeError) {
            removeError.textContent = 'Network error removing ticker.';
            removeError.classList.remove('hidden');
          }
        } finally {
          removeSubmitBtn.disabled = false;
          removeSubmitBtn.textContent = 'REMOVE FROM UNIVERSE';
        }
      });
    }
  }


  // Quick Recon Dropdown & Button
  const quickReconSelect = document.getElementById('quick-recon-select');
  const quickReconBtn = document.getElementById('quick-recon-btn');
  if (quickReconBtn && quickReconSelect) {
    quickReconBtn.addEventListener('click', () => {
      if (quickReconSelect.value) {
        fetchRecon(quickReconSelect.value);
      } else {
        showToast('Please select a ticker from the dropdown');
      }
    });
    quickReconSelect.addEventListener('change', () => {
      if (quickReconSelect.value) {
        fetchRecon(quickReconSelect.value);
      }
    });
  }

  // Comms Terminal Input Form
  const chatForm = document.getElementById('julie-chat-form');
  const chatInput = document.getElementById('julie-chat-input');
  if (chatForm && chatInput) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = chatInput.value ? chatInput.value.trim() : '';
      if (!val) return;
      chatInput.value = '';
      handleUserDirective(val);
    });
  }
}

/* ========================================================
   PORTFOLIO DATA LOADER
======================================================== */
async function loadPortfolio(showLoading = true) {
  try {
    const res = await fetch('/api/plugins/war-room/portfolio');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentPortfolio = data;

    // Populate Quick Recon Dropdown
    populateQuickReconDropdown(data.clusters || []);

    // Sync active scan state if server is scanning
    if (data.active_scan && data.active_scan.isScanning && !activeScanState.isScanning) {
      startScanTracking(data.active_scan);
    }

    updateRibbon(data);
    updateTickerTape(data);
    renderMatrix();
    renderD3Swarm(data);
  } catch (err) {
    console.error('[WarRoom Client] Error fetching portfolio:', err);
  }
}

/* ========================================================
   INTEGRATED LIVE TICKER TAPE DATA BINDING
======================================================== */
function updateTickerTape(data) {
  const track1 = document.getElementById('ticker-track-primary');
  const track2 = document.getElementById('ticker-track-secondary');
  if (!track1 || !track2) return;

  let assets = data.assets || [];
  if (!assets.length && data.clusters) {
    assets = data.clusters.flatMap(c => c.assets || []);
  }
  if (!assets.length) return;

  const itemsHtml = assets.map(a => {
    const spot = (typeof a.spot_price === 'number' && !isNaN(a.spot_price)) 
      ? `$${a.spot_price.toFixed(2)}` 
      : '$--';
    const chg = (typeof a.change_24h_pct === 'number' && !isNaN(a.change_24h_pct)) 
      ? a.change_24h_pct 
      : 0;
    const isPos = chg >= 0;
    const chgCls = isPos ? 'pos' : 'neg';
    const arrow = isPos ? '▲' : '▼';
    const sign = isPos ? '+' : '';
    return `<span class="ticker-item"><span class="ticker-sym">${a.ticker}</span> <span class="ticker-prc">${spot}</span> <span class="ticker-chg ${chgCls}">(${sign}${chg.toFixed(2)}% ${arrow})</span><span class="ticker-sep">|</span></span>`;
  }).join('');

  track1.innerHTML = itemsHtml;
  track2.innerHTML = itemsHtml;
}

function updateRibbon(data) {
  const totalEquityEl = document.getElementById('total-equity');
  const equitySubEl = document.getElementById('equity-sub');
  const ownedCountEl = document.getElementById('owned-count');
  const watchCountEl = document.getElementById('watchlist-count');
  const pillOwnedEl = document.getElementById('pill-owned-count');
  const pillWatchEl = document.getElementById('pill-watch-count');
  const cacheAgeEl = document.getElementById('cache-age-display');
  const sentStatusEl = document.getElementById('sentiment-status');
  const scanSubEl = document.getElementById('scan-sub');

  if (totalEquityEl) {
    totalEquityEl.textContent = `$${data.total_equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (equitySubEl) {
    equitySubEl.textContent = `${data.total_positions_owned} Active ${data.total_positions_owned === 1 ? 'Position' : 'Positions'}`;
  }
  if (ownedCountEl) ownedCountEl.textContent = data.total_positions_owned;
  if (watchCountEl) watchCountEl.textContent = data.total_watchlist;
  if (pillOwnedEl) pillOwnedEl.textContent = data.total_positions_owned;
  if (pillWatchEl) pillWatchEl.textContent = data.total_watchlist;
  if (cacheAgeEl) cacheAgeEl.textContent = `Cache: ${data.cache_age_sec}s ago`;
  const footOwned = document.getElementById('radar-foot-owned');
  const footWatch = document.getElementById('radar-foot-watch');
  if (footOwned) footOwned.textContent = data.total_positions_owned;
  if (footWatch) footWatch.textContent = data.total_watchlist;


  if (sentStatusEl) {
    if (activeScanState.isScanning) {
      sentStatusEl.innerHTML = '<span class="status-dot pulsing"></span> SCANNING';
      if (scanSubEl) scanSubEl.textContent = `${activeScanState.clusterName || 'Assets'} in progress...`;
    } else {
      sentStatusEl.innerHTML = '<span class="status-dot green"></span> ONLINE';
      if (scanSubEl) scanSubEl.textContent = 'Passive Sentiment Daemon';
    }
  }
}

function populateQuickReconDropdown(clusters) {
  const select = document.getElementById('quick-recon-select');
  if (!select || select.children.length > 1) return;

  const assets = [];
  clusters.forEach(c => {
    (c.assets || []).forEach(a => {
      assets.push({ ticker: a.ticker, name: a.name });
    });
  });

  assets.sort((a, b) => a.ticker.localeCompare(b.ticker));

  assets.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.ticker;
    opt.textContent = `${a.ticker} — ${a.name}`;
    select.appendChild(opt);
  });
}

/* ========================================================
   OPTION C: QUANTUM NEURAL SPHERE & CURVED HUD BRACKET OSCILLOSCOPE
   Voice-Reactive 60FPS WebGL/Canvas Motion Engine
======================================================== */

class JulieAcousticVisualizer {
  constructor() {
    this.stageVideo = document.getElementById('julie-stage-video');
    this.oscCanvas = document.getElementById('julie-oscilloscope-canvas');
    this.stateLabel = document.getElementById('orb-state-label');
    this.dotEl = document.getElementById('julie-dot');

    this.oscCtx = this.oscCanvas ? this.oscCanvas.getContext('2d') : null;

    this.width = 570;
    this.height = 320;
    this.dpr = window.devicePixelRatio || 1;

    this.state = 'idle'; // 'idle' | 'listening' | 'thinking' | 'speaking'
    this.time = 0;

    // Amplitude & Voice Modulation
    this.currentAmp = 6.0;      // Lerped visualizer amplitude
    this.targetAmp = 6.0;
    this.speechEnergy = 0.0;     // 0.0 to 1.0 speech envelope
    this.isSpeakingSynthetic = false;

    // Web Audio API State
    this.audioCtx = null;
    this.analyser = null;
    this.freqData = null;
    this.timeData = null;
    this.micStream = null;
    this.micSource = null;

    // Layer 1: Native HTML5 video setup - steady neutral resting pose
    if (this.stageVideo) {
      this.stageVideo.muted = true;
      this.stageVideo.loop = true;
      this.stageVideo.playsInline = true;
      this.stageVideo.pause();
      const resetToSteady = () => {
        if (this.state !== 'speaking') {
          this.stageVideo.pause();
          this.stageVideo.currentTime = 0;
        }
      };
      if (this.stageVideo.readyState >= 1) {
        resetToSteady();
      } else {
        this.stageVideo.addEventListener('loadedmetadata', resetToSteady, { once: true });
        this.stageVideo.addEventListener('canplay', resetToSteady, { once: true });
      }
    }

    // Background Neural Synapse Nodes in 4 Corners (Layer 2)
    this.synapses = [];
    this.initSynapses();

    // Resize handling
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  }

  initSynapses() {
    this.synapses = [
      // Top-Left Corner
      { x: 30, y: 24, branches: [{ x: 90, y: 18 }, { x: 65, y: 48 }], color: '#00e5ff', pulse: 0 },
      { x: 75, y: 16, branches: [{ x: 135, y: 28 }], color: '#a855f7', pulse: 1.2 },
      // Bottom-Left Corner
      { x: 35, by: 26, branches: [{ x: 95, by: 18 }, { x: 70, by: 48 }], color: '#a855f7', pulse: 2.1 },
      { x: 80, by: 16, branches: [{ x: 140, by: 28 }], color: '#00e5ff', pulse: 0.8 },
      // Top-Right Corner
      { rx: 30, y: 24, branches: [{ rx: 90, y: 18 }, { rx: 65, y: 48 }], color: '#00e5ff', pulse: 1.7 },
      { rx: 75, y: 16, branches: [{ rx: 135, y: 28 }], color: '#a855f7', pulse: 2.9 },
      // Bottom-Right Corner
      { rx: 35, by: 26, branches: [{ rx: 95, by: 18 }, { rx: 70, by: 48 }], color: '#a855f7', pulse: 0.4 },
      { rx: 80, by: 16, branches: [{ rx: 140, by: 28 }], color: '#00e5ff', pulse: 2.3 }
    ];
  }

  handleResize() {
    if (!this.oscCanvas || !this.oscCanvas.parentElement) return;
    const rect = this.oscCanvas.parentElement.getBoundingClientRect();
    this.width = rect.width || 570;
    this.height = rect.height || 320;

    this.oscCanvas.width = this.width * this.dpr;
    this.oscCanvas.height = this.height * this.dpr;
    if (this.oscCtx) {
      this.oscCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.oscCtx.scale(this.dpr, this.dpr);
    }
  }

  setState(state) {
    this.state = state;
    orbState = state;
    this.syncVideoMotion();
  }

  setSpeaking(bool) {
    this.isSpeakingSynthetic = !!bool;
    this.syncVideoMotion();
  }

  syncVideoMotion() {
    if (!this.stageVideo) return;
    const isSpeaking = this.state === 'speaking' || this.isSpeakingSynthetic ||
                       (window.speechSynthesis && window.speechSynthesis.speaking);

    if (isSpeaking) {
      if (this.stageVideo.paused) {
        this.stageVideo.play().catch(err => {
          console.log('[JulieVisualizer] Video speech play catch:', err.message);
        });
      }
    } else {
      if (!this.stageVideo.paused) {
        this.stageVideo.pause();
      }
      this.stageVideo.currentTime = 0;
    }
  }

  async startMicrophoneCapture() {
    try {
      if (!this.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      if (!this.analyser) {
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.82;
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
        this.timeData = new Uint8Array(this.analyser.fftSize);
      }
      if (!this.micStream && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.micSource = this.audioCtx.createMediaStreamSource(this.micStream);
        this.micSource.connect(this.analyser);
      }
    } catch (e) {
      console.warn('[JulieVisualizer] Web Audio mic capture fallback:', e.message);
    }
  }

  stopMicrophoneCapture() {
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
      this.micSource = null;
    }
  }

  getAudioMetrics() {
    let micVol = 0;
    let micFreqHigh = 0;

    // 1. Check real Web Audio Analyser
    if (this.analyser && this.freqData) {
      this.analyser.getByteFrequencyData(this.freqData);
      let sum = 0;
      for (let i = 0; i < this.freqData.length; i++) {
        sum += this.freqData[i];
      }
      micVol = sum / (this.freqData.length * 255);
      let highSum = 0;
      for (let i = Math.floor(this.freqData.length * 0.5); i < this.freqData.length; i++) {
        highSum += this.freqData[i];
      }
      micFreqHigh = highSum / ((this.freqData.length * 0.5) * 255);
    }

    // 2. Check TTS or Speech Synthesis activity
    const isTTSActive = (window.speechSynthesis && window.speechSynthesis.speaking) ||
                        this.state === 'speaking' ||
                        this.isSpeakingSynthetic;

    if (isTTSActive) {
      const t = this.time * 4.2;
      const syllableBurst = Math.max(0, Math.sin(t) * 0.7 + Math.sin(t * 1.8) * 0.3);
      const wordPause = Math.sin(this.time * 1.1) > -0.35 ? 1.0 : 0.15;
      const vocalRhythm = syllableBurst * wordPause;
      const syntheticEnergy = 0.35 + 0.65 * vocalRhythm;
      this.speechEnergy += (syntheticEnergy - this.speechEnergy) * 0.18;
    } else if (this.state === 'listening' && micVol > 0.05) {
      this.speechEnergy += (micVol * 2.2 - this.speechEnergy) * 0.22;
    } else if (this.state === 'thinking') {
      const pulse = 0.35 + 0.25 * Math.sin(this.time * 3.5);
      this.speechEnergy += (pulse - this.speechEnergy) * 0.15;
    } else {
      this.speechEnergy += (0.0 - this.speechEnergy) * 0.08;
    }

    this.speechEnergy = Math.max(0, Math.min(1.0, this.speechEnergy));

    // Calculate Target Amplitude for Oscilloscope Ribbons
    if (this.state === 'idle') {
      this.targetAmp = 5.0 + 2.5 * Math.sin(this.time * 0.8);
    } else if (this.state === 'listening') {
      this.targetAmp = 18.0 + 45.0 * (micVol > 0 ? micVol : this.speechEnergy);
    } else if (this.state === 'thinking') {
      this.targetAmp = 20.0 + 15.0 * Math.sin(this.time * 4.0);
    } else if (this.state === 'speaking') {
      this.targetAmp = 22.0 + 44.0 * this.speechEnergy;
    }

    // Smooth Lerp Damping
    this.currentAmp += (this.targetAmp - this.currentAmp) * 0.15;

    return {
      energy: this.speechEnergy,
      amp: this.currentAmp,
      highRipple: micFreqHigh || (this.speechEnergy * 0.6)
    };
  }

  render() {
    this.time += 0.032;

    const metrics = this.getAudioMetrics();

    // LAYER 1: Full-Bleed Native HTML5 Video Stage
    // Head remains 100% steady on neutral frame 0 when not speaking (idle, listening, thinking)
    // Head motion & lip articulation activates ONLY when actively speaking
    const isSpeaking = this.state === 'speaking' || this.isSpeakingSynthetic ||
                       (window.speechSynthesis && window.speechSynthesis.speaking);

    if (this.stageVideo) {
      if (isSpeaking) {
        if (this.stageVideo.paused) {
          this.stageVideo.play().catch(() => {});
        }
      } else {
        if (!this.stageVideo.paused) {
          this.stageVideo.pause();
          this.stageVideo.currentTime = 0;
        }
      }
    }

    // LAYER 2: Additive Harmonic Sine-Wave Oscilloscope
    // Background ribbons and synapse nodes continue their fluid 60FPS animation at all times
    if (this.oscCtx) {
      this.renderOscilloscopeStage(metrics);
    }

    requestAnimationFrame(() => this.render());
  }

  renderOscilloscopeStage(metrics) {
    const ctx = this.oscCtx;
    const w = this.width;
    const h = this.height;
    const cy = h * 0.46; // Aligned with Julie's visual center
    const cx = w * 0.50;

    ctx.clearRect(0, 0, w, h);

    // 1. Background Synaptic Filaments in 4 Corners
    this.renderSynapticFilaments(ctx, w, h, metrics.energy);

    // 2. Dual-Wing Harmonic Sine-Wave Oscilloscope Spanning Flanking HUD Brackets
    // Left Wing: from x = 0 to outer edge of left Curved HUD Bracket (cx - 110px)
    // Right Wing: from outer edge of right Curved HUD Bracket (cx + 110px) to x = w
    const bracketInnerHalfWidth = 110;
    const leftWingStart = 0;
    const leftWingEnd = Math.max(30, cx - bracketInnerHalfWidth);
    const rightWingStart = Math.min(w - 30, cx + bracketInnerHalfWidth);
    const rightWingEnd = w;

    const numRibbons = 10;

    // Render Left Wing Harmonic Ribbons
    for (let k = 0; k < numRibbons; k++) {
      this.renderRibbon(ctx, leftWingStart, leftWingEnd, cy, k, numRibbons, metrics, 'left');
    }

    // Render Right Wing Harmonic Ribbons
    for (let k = 0; k < numRibbons; k++) {
      this.renderRibbon(ctx, rightWingStart, rightWingEnd, cy, k, numRibbons, metrics, 'right');
    }
  }

  renderRibbon(ctx, startX, endX, cy, index, total, metrics, side) {
    const span = endX - startX;
    if (span <= 10) return;

    const kNorm = index / total;
    const phaseShift = index * (Math.PI / 4.5) + this.time * (0.8 + index * 0.14);
    const harmonicMult = 1.0 + index * 0.32;
    const ribbonAmp = metrics.amp * (1.1 - kNorm * 0.45);

    // Color gradient across the wing
    const grad = ctx.createLinearGradient(
      side === 'left' ? endX : startX, cy,
      side === 'left' ? startX : endX, cy
    );

    if (this.state === 'thinking') {
      grad.addColorStop(0, 'rgba(251, 191, 36, 0.95)');
      grad.addColorStop(0.5, 'rgba(245, 158, 11, 0.6)');
      grad.addColorStop(1, 'rgba(168, 85, 247, 0.05)');
    } else if (this.state === 'speaking' || metrics.energy > 0.15) {
      grad.addColorStop(0, 'rgba(0, 229, 255, 0.98)');
      grad.addColorStop(0.35, 'rgba(168, 85, 247, 0.85)');
      grad.addColorStop(0.7, 'rgba(236, 72, 153, 0.55)');
      grad.addColorStop(1, 'rgba(0, 229, 255, 0.02)');
    } else {
      // Idle cyan-to-violet harmonic ribbon
      grad.addColorStop(0, 'rgba(0, 229, 255, 0.88)');
      grad.addColorStop(0.45, 'rgba(168, 85, 247, 0.65)');
      grad.addColorStop(0.85, 'rgba(56, 189, 248, 0.35)');
      grad.addColorStop(1, 'rgba(0, 229, 255, 0.02)');
    }

    ctx.save();
    ctx.beginPath();

    const steps = 44;
    const dx = span / steps;

    for (let i = 0; i <= steps; i++) {
      const x = startX + i * dx;
      const xNorm = i / steps;

      // Envelope dampening: zero at inner bracket edge, tapered towards screen edge
      const envelope = side === 'left'
        ? Math.sin(xNorm * Math.PI * 0.5) * (1 - Math.exp(-xNorm * 4))
        : Math.sin((1 - xNorm) * Math.PI * 0.5) * (1 - Math.exp(-(1 - xNorm) * 4));

      const freq1 = 0.038 * harmonicMult;
      const freq2 = 0.082 * (1.0 + kNorm * 0.4);
      const wave1 = Math.sin((x * freq1) + phaseShift);
      const wave2 = Math.cos((x * freq2) - this.time * 1.6);
      const ripple = metrics.highRipple * Math.sin(x * 0.18 + this.time * 5.0) * 4.0;

      const y = cy + (wave1 * ribbonAmp + wave2 * (ribbonAmp * 0.45) + ripple) * envelope;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.strokeStyle = grad;
    ctx.lineWidth = index === 0 ? 1.8 : 1.1;
    ctx.globalAlpha = 0.40 + (1 - kNorm) * 0.52;
    ctx.shadowColor = index < 3 ? '#00e5ff' : 'transparent';
    ctx.shadowBlur = index < 3 ? 6 : 0;
    ctx.stroke();
    ctx.restore();
  }

  renderSynapticFilaments(ctx, w, h, speechEnergy) {
    ctx.save();
    const pulse = Math.sin(this.time * 2.2);

    this.synapses.forEach(s => {
      const startX = s.rx !== undefined ? w - s.rx : s.x;
      const startY = s.by !== undefined ? h - s.by : s.y;
      const alpha = 0.18 + 0.12 * Math.sin(this.time * 1.8 + s.pulse) + speechEnergy * 0.3;

      ctx.strokeStyle = s.color === '#00e5ff' ? `rgba(0, 229, 255, ${alpha})` : `rgba(168, 85, 247, ${alpha})`;
      ctx.lineWidth = 1.0;

      s.branches.forEach(b => {
        const destX = b.rx !== undefined ? w - b.rx : b.x;
        const destY = b.by !== undefined ? h - b.by : b.y;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        const midX = (startX + destX) / 2 + (pulse * 4);
        const midY = (startY + destY) / 2 - (pulse * 4);
        ctx.quadraticCurveTo(midX, midY, destX, destY);
        ctx.stroke();

        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(destX, destY, 1.6 + speechEnergy * 0.8, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(startX, startY, 2.0 + speechEnergy * 1.0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }
  start() {
    if (this.stageVideo) {
      this.stageVideo.pause();
      this.stageVideo.currentTime = 0;
    }

    this.render();
  }
}

// Global reference & initialization
window.JulieAcousticVisualizer = JulieAcousticVisualizer;
window.julieVisualizer = null;

function initJulieOrb() {
  if (!window.julieVisualizer) {
    window.julieVisualizer = new JulieAcousticVisualizer();
    window.julieVisualizer.start();
  }
}

function setJulieState(state) {
  orbState = state;
  if (window.julieVisualizer) window.julieVisualizer.setState(state);
  const labelEl = document.getElementById('orb-state-label');
  const dotEl = document.getElementById('julie-dot');
  if (!labelEl) return;

  if (state === 'listening') {
    labelEl.textContent = 'LISTENING // AUDIO INPUT';
    labelEl.style.color = 'var(--purple)';
    if (dotEl) dotEl.className = 'status-dot pulsing';
  } else if (state === 'thinking') {
    labelEl.textContent = 'THINKING // QUANT REASONING';
    labelEl.style.color = 'var(--amber)';
    if (dotEl) dotEl.className = 'status-dot pulsing';
  } else if (state === 'speaking') {
    labelEl.textContent = 'SPEAKING // TRANSMITTING';
    labelEl.style.color = 'var(--emerald)';
    if (dotEl) dotEl.className = 'status-dot green';
  } else {
    labelEl.textContent = 'IDLE // STANDBY';
    labelEl.style.color = 'var(--cyan)';
    if (dotEl) dotEl.className = 'status-dot green';
  }
}

/* ========================================================
   CLEAN US-ENGLISH FEMALE TTS & BROWSER STT ENGINES
======================================================== */
let cachedEnglishVoice = null;

function loadEnglishFemaleVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (voices.length === 0) return null;

  // Filter out any voice that is French or explicitly marked with French accent
  const nonFrench = voices.filter(v => {
    const lang = (v.lang || '').toLowerCase();
    const name = (v.name || '').toLowerCase();
    if (lang.startsWith('fr')) return false;
    if (/french|français|hortense|caroline|claude|harmonie|denise|henri|julie \(french\)/i.test(name)) return false;
    return true;
  });

  // Priority 1: Microsoft Aria Online (Natural) or Microsoft Jenny Online (Natural)
  let chosen = nonFrench.find(v => /aria.*natural|jenny.*natural/i.test(v.name) && v.lang.startsWith('en'));
  if (chosen) {
    cachedEnglishVoice = chosen;
    console.log('[Julie TTS] Active US-English voice selected (Priority 1):', chosen.name, `[${chosen.lang}]`);
    return chosen;
  }

  // Priority 2: Google US English (Female)
  chosen = nonFrench.find(v => /google\s+us\s+english/i.test(v.name) && v.lang === 'en-US');
  if (chosen) {
    cachedEnglishVoice = chosen;
    console.log('[Julie TTS] Active US-English voice selected (Priority 2):', chosen.name, `[${chosen.lang}]`);
    return chosen;
  }

  // Priority 3: Microsoft Zira Desktop / Natural (English United States)
  chosen = nonFrench.find(v => /zira/i.test(v.name) && v.lang.startsWith('en'));
  if (chosen) {
    cachedEnglishVoice = chosen;
    console.log('[Julie TTS] Active US-English voice selected (Priority 3):', chosen.name, `[${chosen.lang}]`);
    return chosen;
  }

  // Priority 4: Any en-US voice with female naming cues
  chosen = nonFrench.find(v => (v.lang === 'en-US' || v.lang === 'en_US') && /female|zira|aria|jenny|samantha|sara|sonia|natasha|victoria|eva|karen|susan/i.test(v.name));
  if (chosen) {
    cachedEnglishVoice = chosen;
    console.log('[Julie TTS] Active US-English voice selected (Priority 4):', chosen.name, `[${chosen.lang}]`);
    return chosen;
  }

  // Priority 5: Any clean en-US voice
  chosen = nonFrench.find(v => v.lang === 'en-US' || v.lang === 'en_US');
  if (chosen) {
    cachedEnglishVoice = chosen;
    console.log('[Julie TTS] Active US-English voice selected (Priority 5):', chosen.name, `[${chosen.lang}]`);
    return chosen;
  }

  // Fallback: Any English voice
  chosen = nonFrench.find(v => v.lang.startsWith('en'));
  if (chosen) {
    cachedEnglishVoice = chosen;
    console.log('[Julie TTS] Active English voice selected (Fallback):', chosen.name, `[${chosen.lang}]`);
    return chosen;
  }

  return null;
}

// Pre-load and cache voice immediately
if ('speechSynthesis' in window) {
  loadEnglishFemaleVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    loadEnglishFemaleVoice();
  };
}

function cleanTextForSpeech(rawText) {
  if (!rawText) return '';
  let text = String(rawText)
    .replace(/[*#_`]/g, '')
    .replace(/•/g, '')
    .replace(/σ/g, 'sigma')
    .replace(/cuda:[0-1]/gi, 'Cuda');

  // Strip dollar sign from ticker cashtags like $ENB, $CCJ, $BTC-USD
  text = text.replace(/\$([A-Za-z\-]+)\b/g, '$1');

  // Protect common corporate abbreviations so periods don't trigger sentence splits
  text = text.replace(/\bInc\./gi, 'Inc,');
  text = text.replace(/\bCorp\./gi, 'Corp,');
  text = text.replace(/\bLtd\./gi, 'Limited,');
  text = text.replace(/\bCo\./gi, 'Company,');
  text = text.replace(/z-score:\s*/gi, 'z-score of ');

  // Convert formatted currency: e.g. $11,487.30, $48.55, $151,756.83, $100
  text = text.replace(/\$([0-9,]+)(?:\.([0-9]{1,2}))?/g, (match, dollarsStr, centsStr) => {
    const cleanDollars = dollarsStr.replace(/,/g, '');
    const dollars = parseInt(cleanDollars, 10);
    const cents = centsStr ? parseInt(centsStr, 10) : 0;
    
    if (isNaN(dollars)) return match;
    
    const dollarPart = `${dollars.toLocaleString('en-US')} dollar${dollars === 1 ? '' : 's'}`;
    if (cents > 0) {
      return `${dollarPart} and ${cents} cent${cents === 1 ? '' : 's'}`;
    }
    return dollarPart;
  });

  // Clean signed and raw percentages: +0.35% -> plus 0.35 percent, -0.7% -> down 0.7 percent
  text = text.replace(/\+([0-9.]+)\%/g, 'plus $1 percent');
  text = text.replace(/-([0-9.]+)\%/g, 'down $1 percent');
  text = text.replace(/([0-9.]+)\%/g, '$1 percent');

  // Multipliers: 1.05x -> 1.05 times
  text = text.replace(/([0-9.]+)x\b/gi, '$1 times');

  // Convert parenthesized tickers: ($ENB) -> , ENB,
  text = text.replace(/\(([A-Za-z0-9\-]+)\)/g, ', $1,');
  text = text.replace(/[()[\]]/g, ' ');

  return text.replace(/\s+/g, ' ').trim();
}

function chunkForSpeech(text) {
  // Split on sentence boundaries: period, exclamation, question mark followed by whitespace or end of string
  // Prevents splitting decimals (like 48.55 or 1.05)
  const chunks = text.split(/(?<=[.!?])\s+/);
  return chunks.map(c => c.trim()).filter(Boolean);
}

function speakJulieText(text) {
  if (isVoiceMuted || !('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();
  window.activeUtterances.clear();

  setJulieState('speaking');

  if (!cachedEnglishVoice) {
    loadEnglishFemaleVoice();
  }

  const sanitized = cleanTextForSpeech(text);
  const chunks = chunkForSpeech(sanitized);

  chunks.forEach((chunk, index) => {
    const cleanChunk = chunk.trim();
    if (!cleanChunk) return;

    const utterance = new SpeechSynthesisUtterance(cleanChunk);
    if (cachedEnglishVoice) {
      utterance.voice = cachedEnglishVoice;
    }
    utterance.lang = 'en-US';
    utterance.rate = 1.02;
    utterance.pitch = 1.0;

    window.activeUtterances.add(utterance);

    utterance.onend = () => {
      window.activeUtterances.delete(utterance);
      if (window.activeUtterances.size === 0 && orbState === 'speaking') {
        setJulieState('idle');
      }
    };

    utterance.onerror = (e) => {
      window.activeUtterances.delete(utterance);
      if (window.activeUtterances.size === 0 && orbState === 'speaking') {
        setJulieState('idle');
      }
    };

    window.speechSynthesis.speak(utterance);
  });
}

function initSpeechRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    console.warn('[Julie STT] Web Speech API not supported in this browser.');
    return;
  }

  speechRecognition = new SpeechRec();
  speechRecognition.continuous = false;
  speechRecognition.interimResults = false;
  speechRecognition.lang = 'en-US';

  speechRecognition.onstart = () => {
    isRecording = true;
    setJulieState('listening');
    if (window.julieVisualizer) window.julieVisualizer.startMicrophoneCapture();
    const micBtn = document.getElementById('julie-mic-btn');
    if (micBtn) {
      micBtn.classList.add('recording');
      micBtn.innerHTML = '<span class="btn-icon">🔴</span> Listening...';
    }
  };

  speechRecognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    if (transcript && transcript.trim()) {
      handleUserDirective(transcript.trim());
    }
  };

  speechRecognition.onerror = (event) => {
    console.warn('[Julie STT] Speech error:', event.error);
    stopRecording();
  };

  speechRecognition.onend = () => {
    stopRecording();
  };
}

function stopRecording() {
  isRecording = false;
  if (orbState === 'listening') setJulieState('idle');
  if (window.julieVisualizer) window.julieVisualizer.stopMicrophoneCapture();
  const micBtn = document.getElementById('julie-mic-btn');
  if (micBtn) {
    micBtn.classList.remove('recording');
    micBtn.innerHTML = '<span class="btn-icon">🎙️</span> Push to Talk';
  }
}

function togglePushToTalk() {
  if (!speechRecognition) {
    showToast('Web Speech Recognition not supported in this browser.');
    return;
  }
  if (isRecording) {
    speechRecognition.stop();
  } else {
    try {
      speechRecognition.start();
    } catch (e) {
      console.warn('SpeechRecognition start err:', e);
    }
  }
}

/* ========================================================
   LIVE COMMS TERMINAL & INTENT DISPATCHER
======================================================== */
function appendTerminalMessage(sender, text, type = 'julie', metadata = null) {
  const feed = document.getElementById('julie-terminal-feed');
  if (!feed) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `terminal-msg ${type}`;

  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  let extraHtml = '';
  if (metadata && (metadata.holdings_risk_matrix || metadata.action_triggered === 'MORNING_BRIEF')) {
    const matrix = metadata.holdings_risk_matrix || metadata.brief_data?.holdings_risk_matrix || [];
    const metrics = metadata.metrics || metadata.brief_data?.metrics || {};
    const rowsHtml = matrix.map(h => {
      const flagPills = (h.flags || []).map(f => {
        if (f === 'STOP_PROXIMITY_ALERT') return '<span class="flag-pill alert">STOP ALERT</span>';
        if (f === 'BELOW_TREND') return '<span class="flag-pill trend">BELOW 20SMA</span>';
        if (f === 'HYPE_WARNING') return '<span class="flag-pill hype">HYPE MOD</span>';
        return `<span class="flag-pill">${f}</span>`;
      }).join(' ');

      const rowCls = h.is_flagged ? (h.flags.includes('STOP_PROXIMITY_ALERT') ? 'flagged-row urgent' : 'flagged-row') : '';
      const cushionColor = h.stop_cushion_pct < 3.0 ? 'text-rose' : (h.stop_cushion_pct < 6.0 ? 'text-amber' : 'text-emerald');

      const targetP50 = h.forecast_5d_p50 ? `$${Number(h.forecast_5d_p50).toFixed(2)}` : `$${Number(h.spot_price).toFixed(2)}`;
      const returnPctStr = h.forecast_return_pct != null ? `${h.forecast_return_pct >= 0 ? '+' : ''}${h.forecast_return_pct.toFixed(1)}%` : '';
      const srcBadge = (h.forecast_source && h.forecast_source !== 'ATR_VOLATILITY_FALLBACK')
        ? '<span class="source-tag gpu">GPU</span>'
        : '<span class="source-tag atr">ATR</span>';

      return `
        <tr class="${rowCls}">
          <td><strong>$${h.ticker}</strong></td>
          <td>${h.shares}</td>
          <td>$${Number(h.spot_price).toFixed(2)}</td>
          <td><span class="text-emerald">${targetP50}</span> <small class="text-cyan">(${returnPctStr})</small> ${srcBadge}</td>
          <td class="text-amber">$${Number(h.dynamic_stop_2atr).toFixed(2)}</td>
          <td class="${cushionColor}">+${h.stop_cushion_pct.toFixed(1)}%</td>
          <td>$${h.dollar_risk_to_stop.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td>${h.sma_regime === 'ABOVE_20SMA' ? '<span class="text-emerald">ABOVE</span>' : '<span class="text-rose">BELOW</span>'}</td>
          <td>${flagPills || '<span class="text-emerald">NOMINAL</span>'}</td>
        </tr>
      `;
    }).join('');

    extraHtml = `
      <div class="holdings-risk-card">
        <div class="risk-card-header">
          <span class="risk-card-title">⚡ ACTIVE HOLDINGS RISK AUDIT (${matrix.length} POSITIONS)</span>
          <span class="risk-card-stats">
            Equity: $${(metrics.total_equity || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | 
            Stop Risk: <span class="text-amber">$${(metrics.total_dollar_risk_to_stop || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> |
            Flagged: <span class="${metrics.flagged_count > 0 ? 'text-rose' : 'text-emerald'}">${metrics.flagged_count || 0}</span>
          </span>
        </div>
        <div class="risk-table-wrapper">
          <table class="risk-table">
            <thead>
              <tr>
                <th>TICKER</th>
                <th>SHARES</th>
                <th>SPOT</th>
                <th>5D TARGET (p50)</th>
                <th>2x ATR STOP</th>
                <th>CUSHION</th>
                <th>STOP RISK</th>
                <th>20-SMA</th>
                <th>REGIME / FLAGS</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (metadata && (metadata.comparator_data || metadata.action_triggered === 'HEAD_TO_HEAD_COMPARISON')) {
    const comp = metadata.comparator_data || {};
    const a = comp.asset_a || {};
    const b = comp.asset_b || {};

    extraHtml = `
      <div class="comparator-card">
        <div class="comparator-header">
          <span class="comparator-title">⚔️ QUANTITATIVE HEAD-TO-HEAD COMPARISON</span>
          <span class="recon-val text-cyan">$${a.ticker} vs $${b.ticker}</span>
        </div>
        <div class="comparator-grid">
          <div class="comp-col-a">
            <div class="comp-asset-header">$${a.ticker} (${a.name || ''})</div>
            <div class="comp-metric-val">$${Number(a.spot_price).toFixed(2)} (${a.change_24h_pct >= 0 ? '+' : ''}${a.change_24h_pct}%)</div>
            <div class="comp-metric-val ${a.atr_14_pct <= b.atr_14_pct ? 'highlight' : ''}">${a.atr_14_pct}%</div>
            <div class="comp-metric-val text-amber">$${Number(a.dynamic_stop_2atr).toFixed(2)}</div>
            <div class="comp-metric-val">±$${Number(a.expected_move_5d || 0).toFixed(2)}</div>
            <div class="comp-metric-val ${a.sma_regime === 'ABOVE_20SMA' ? 'highlight' : ''}">${(a.sma_regime || '').replace(/_/g, ' ')}</div>
            <div class="comp-metric-val ${a.risk_modifier >= b.risk_modifier ? 'highlight' : ''}">${a.risk_modifier}x Sizing</div>
          </div>
          <div class="comp-col-metrics">
            <div class="comp-asset-header">METRIC</div>
            <div>SPOT (24H)</div>
            <div>14-DAY ATR %</div>
            <div>2.0x ATR STOP</div>
            <div>5-DAY CONE</div>
            <div>20-DAY SMA</div>
            <div>RISK MODIFIER</div>
          </div>
          <div class="comp-col-b">
            <div class="comp-asset-header">$${b.ticker} (${b.name || ''})</div>
            <div class="comp-metric-val">$${Number(b.spot_price).toFixed(2)} (${b.change_24h_pct >= 0 ? '+' : ''}${b.change_24h_pct}%)</div>
            <div class="comp-metric-val ${b.atr_14_pct <= a.atr_14_pct ? 'highlight' : ''}">${b.atr_14_pct}%</div>
            <div class="comp-metric-val text-amber">$${Number(b.dynamic_stop_2atr).toFixed(2)}</div>
            <div class="comp-metric-val">±$${Number(b.expected_move_5d || 0).toFixed(2)}</div>
            <div class="comp-metric-val ${b.sma_regime === 'ABOVE_20SMA' ? 'highlight' : ''}">${(b.sma_regime || '').replace(/_/g, ' ')}</div>
            <div class="comp-metric-val ${b.risk_modifier >= a.risk_modifier ? 'highlight' : ''}">${b.risk_modifier}x Sizing</div>
          </div>
        </div>
      </div>
    `;
  } else if (metadata && metadata.whale_data && metadata.whale_data.assets) {
    const assets = Object.values(metadata.whale_data.assets);
    let cardsHtml = '';
    assets.forEach(w => {
      const biasCls = (w.whale_bias || '').toLowerCase().includes('bull') ? 'bullish' : ((w.whale_bias || '').toLowerCase().includes('bear') ? 'bearish' : 'neutral');
      cardsHtml += `
        <div class="recon-telemetry-grid" style="margin-top: 8px;">
          <div class="recon-item">
            <span class="recon-lbl">WHALE BIAS // $${w.ticker}</span>
            <span class="recon-badge ${biasCls}">${w.whale_bias} (${w.confidence}%)</span>
          </div>
          <div class="recon-item">
            <span class="recon-lbl">FLOW REGIME</span>
            <span class="recon-val text-cyan">${(w.flow_regime || 'NEUTRAL').replace(/_/g, ' ')}</span>
          </div>
          <div class="recon-item">
            <span class="recon-lbl">POINT OF CONTROL (POC)</span>
            <span class="recon-val text-emerald">$${Number(w.point_of_control || 0).toFixed(2)}</span>
          </div>
          <div class="recon-item">
            <span class="recon-lbl">VALUE AREA (VAL - VAH)</span>
            <span class="recon-val text-amber">$${Number(w.value_area_low || 0).toFixed(2)} - $${Number(w.value_area_high || 0).toFixed(2)}</span>
          </div>
          <div class="recon-item">
            <span class="recon-lbl">C-SUITE SEC REGULATORY</span>
            <span class="recon-val">${(w.regulatory_state || 'NEUTRAL').replace(/_/g, ' ')}</span>
          </div>
          <div class="recon-item">
            <span class="recon-lbl">OPTIONS C/P RATIO</span>
            <span class="recon-val">${Number(w.call_put_ratio || 1.0).toFixed(2)} (${w.net_premium_flow >= 0 ? '+' : ''}$${Number(w.net_premium_flow || 0).toLocaleString()})</span>
          </div>
        </div>
      `;
    });
    extraHtml = `<div class="whale-scan-container">${cardsHtml}</div>`;
  } else if (type === 'recon' && metadata && metadata.recon) {
    const r = metadata.recon;
    const biasCls = (r.net_bias || '').toLowerCase().includes('bull') ? 'bullish' : ((r.net_bias || '').toLowerCase().includes('bear') ? 'bearish' : 'neutral');

    extraHtml = `
      <div class="recon-telemetry-grid">
        <div class="recon-item">
          <span class="recon-lbl">SPOT PRICE</span>
          <span class="recon-val">$${Number(r.spot_price).toFixed(2)}</span>
        </div>
        <div class="recon-item">
          <span class="recon-lbl">14-DAY ATR</span>
          <span class="recon-val text-cyan">$${Number(r.atr_14 || 0).toFixed(2)} ${r.atr_14_pct ? `(${r.atr_14_pct}%)` : ''}</span>
        </div>
        <div class="recon-item">
          <span class="recon-lbl">DYNAMIC STOP (2x ATR)</span>
          <span class="recon-val text-amber">$${Number(r.invalidation_stop || r.dynamic_stop_2atr || 0).toFixed(2)}</span>
        </div>
        <div class="recon-item">
          <span class="recon-lbl">5D MODEL TARGET (p50) ${(r.forecast_source && r.forecast_source !== 'ATR_VOLATILITY_FALLBACK') ? '<span class="source-tag gpu">GPU: CHRONOS</span>' : '<span class="source-tag atr">ATR FALLBACK</span>'}</span>
          <span class="recon-val text-emerald">${r.forecast_5d_p50 ? `$${Number(r.forecast_5d_p50).toFixed(2)}` : `$${Number(r.timesfm_target || r.upside_target_3atr || 0).toFixed(2)}`} <small class="text-cyan">${r.forecast_return_pct != null ? `(${r.forecast_return_pct >= 0 ? '+' : ''}${r.forecast_return_pct}%)` : ''}</small></span>
        </div>
        <div class="recon-item">
          <span class="recon-lbl">20-DAY SMA</span>
          <span class="recon-val">${r.sma_20 ? `$${Number(r.sma_20).toFixed(2)} (${(r.sma_regime || '').replace(/_/g, ' ')})` : 'CALCULATING'}</span>
        </div>
        <div class="recon-item">
          <span class="recon-lbl">NET QUANT BIAS</span>
          <span class="recon-badge ${biasCls}">${r.net_bias}</span>
        </div>
      </div>
    `;
  }

  msgDiv.innerHTML = `
    <div class="msg-header">
      <span class="msg-sender">${sender}</span>
      <span class="msg-time">${timeStr}</span>
    </div>
    <div class="msg-body">
      ${text}
      ${extraHtml}
    </div>
  `;

  feed.appendChild(msgDiv);
  feed.scrollTop = feed.scrollHeight;
}

// Dynamic Client-side Phonetic STT & Company-to-Ticker Normalization Map
function getDynamicPhoneticMap() {
  const baseMap = {
    'open clara': 'OpenClaw',
    'open claude': 'OpenClaw',
    'open clock': 'OpenClaw',
    'open cloud': 'OpenClaw',
    'open claw': 'OpenClaw',
    'ask clara': 'OpenClaw',
    'ask claw': 'OpenClaw',
    'open clow': 'OpenClaw',
    'open clear': 'OpenClaw',
    'open close': 'OpenClaw',
    'open call': 'OpenClaw',
    'open clone': 'OpenClaw',
    'open cloth': 'OpenClaw',
    'open club': 'OpenClaw',
    'open clock swarm': 'OpenClaw Swarm',
    'julia': 'Julie',
    'war room': 'War Room',
    'time fm': 'TimesFM',
    'times fm': 'TimesFM',
    'kronos': 'Chronos',
    'chronos': 'Chronos'
  };

  const assets = currentPortfolio?.assets || [];
  assets.forEach(a => {
    const t = a.ticker.toUpperCase();
    baseMap[t.toLowerCase()] = t;
    if (t === 'BTC-USD') {
      baseMap['bitcoin'] = 'BTC-USD';
      baseMap['btc'] = 'BTC-USD';
    }
    if (a.name) {
      const rawName = a.name.toLowerCase().trim();
      baseMap[rawName] = t;
      const stripped = rawName
        .replace(/[,.]/g, '')
        .replace(/\b(inc|corp|corporation|ltd|co|holdings|company|companies|plc|a\/s|etf|class [a-z])\b/gi, '')
        .trim();
      if (stripped && stripped.length > 2) {
        baseMap[stripped] = t;
      }
    }
  });
  return baseMap;
}

function normalizeSpeechInput(text) {
  if (!text) return '';
  let normalized = text;
  const map = getDynamicPhoneticMap();
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const pattern of keys) {
    const replacement = map[pattern];
    const regex = new RegExp(`\\b${pattern}\\b`, 'gi');
    normalized = normalized.replace(regex, replacement);
  }
  return normalized;
}

async function handleUserDirective(prompt) {
  if (!prompt || !prompt.trim()) return;
  const userText = normalizeSpeechInput(prompt.trim());

  appendTerminalMessage('Pierre', userText, 'user');
  setJulieState('thinking');

  // If asking for analysis or OpenClaw, show temporary dispatch indicator in live terminal
  const isAnalysisDirective = /(?:analyze|analysis|openclaw|sentiment|scan|check|what do you think of|look at|evaluate|audit|harvest)/i.test(userText);
  if (isAnalysisDirective) {
    appendTerminalMessage('JULIE // TELEMETRY', '⚡ Julie -> Dispatching OpenClaw 3-Tier Harvester...', 'status-temp');
  }

  try {
    const res = await fetch('/api/plugins/war-room/julie/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userText })
    });
    const data = await res.json();

    // If portfolio refresh is requested (e.g. from live single-ticker harvest)
    if (data.refresh_portfolio) {
      await loadPortfolio(false);
    }

    if (data.action_triggered === 'SCAN_CLUSTER' || (data.action_triggered && data.action_triggered.type === 'SCAN_CLUSTER')) {
      const cluster_id = data.cluster_id || data.action_triggered?.cluster_id;
      const cluster_name = data.action_triggered?.cluster_name || `Cluster #${cluster_id}`;
      appendTerminalMessage('JULIE', data.reply, 'julie');
      speakJulieText(data.reply);

      // Automatically trigger background cluster scan & light up D3
      if (currentPortfolio && currentPortfolio.clusters) {
        const targetCluster = currentPortfolio.clusters.find(c => c.id === cluster_id);
        const tickers = targetCluster ? targetCluster.assets.map(a => a.ticker) : [];
        triggerClusterScan(cluster_id, cluster_name, tickers);
      }
    } else if (data.action_triggered === 'VAULT_RECON' || (data.action_triggered && data.action_triggered.type === 'PULL_RECON')) {
      const ticker = data.ticker || data.action_triggered?.ticker;
      appendTerminalMessage('JULIE', data.reply, 'julie');
      speakJulieText(data.reply);
      if (data.recon_data) {
        appendTerminalMessage(`VAULT RECON // ${data.recon_data.ticker}`, data.reply, 'recon', { recon: data.recon_data });
      } else {
        fetchRecon(ticker);
      }
    } else {
      appendTerminalMessage('JULIE', data.reply, 'julie', data);
      speakJulieText(data.reply);
    }
  } catch (err) {
    console.error('[Julie Chat] Error:', err);
    appendTerminalMessage('JULIE', 'Apologies Pierre, local intelligence endpoint error.', 'julie');
    setJulieState('idle');
  }
}

async function triggerMorningBrief() {
  appendTerminalMessage('Pierre', 'Julie, generate Executive Morning Flight Check.', 'user');
  setJulieState('thinking');
  showToast('☀️ Generating Executive Morning Brief & Risk Audit...');

  try {
    const res = await fetch('/api/plugins/war-room/julie/morning-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    appendTerminalMessage('JULIE // MORNING RISK AUDIT', data.brief, 'brief', data);
    speakJulieText(data.brief);
  } catch (err) {
    console.error('[Morning Brief] Error:', err);
    appendTerminalMessage('JULIE', 'Error synthesizing morning flight check.', 'brief');
    setJulieState('idle');
  }
}

async function fetchRecon(ticker) {
  if (!ticker) return;
  const t = ticker.toUpperCase().trim();
  appendTerminalMessage('Pierre', `Requesting Vault Recon on ${t}...`, 'user');
  setJulieState('thinking');

  try {
    const res = await fetch(`/api/plugins/war-room/julie/recon/${t}`);
    const data = await res.json();

    appendTerminalMessage(`VAULT RECON // ${data.ticker}`, data.spoken_summary, 'recon', {
      recon: data
    });

    speakJulieText(data.spoken_summary);
  } catch (err) {
    console.error(`[Recon Error ${ticker}]:`, err);
    appendTerminalMessage('JULIE', `Vault recon for ${t} failed to load.`, 'recon');
    setJulieState('idle');
  }
}

/* ========================================================
   SENTIMENT SCANNING TRIGGER & POLLING ENGINE
======================================================== */
async function triggerClusterScan(clusterId, clusterName, tickers) {
  if (activeScanState.isScanning) {
    showToast('A scan is already in progress. Please wait.');
    return;
  }

  try {
    const res = await fetch('/api/plugins/war-room/scan-sentiment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cluster_id: clusterId,
        cluster_name: clusterName,
        tickers: tickers
      })
    });

    const data = await res.json();
    if (res.status === 409 || data.status === 'BUSY') {
      showToast('Scan in progress by another task.');
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Failed to start scan');

    showToast(`⚡ Initiated scan for ${clusterName} (${tickers.length} assets)...`);
    startScanTracking(data.activeScan);
  } catch (err) {
    console.error('[WarRoom Client] Error starting scan:', err);
    showToast(`Scan trigger failed: ${err.message}`);
  }
}

async function triggerTickerScan(ticker, clusterId) {
  if (activeScanState.isScanning) {
    showToast('A scan is already in progress. Please wait.');
    return;
  }

  try {
    const res = await fetch('/api/plugins/war-room/scan-sentiment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cluster_id: clusterId,
        cluster_name: `Single Asset (${ticker})`,
        tickers: [ticker]
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start scan');

    showToast(`⚡ Initiated single-asset scan for ${ticker}...`);
    startScanTracking(data.activeScan);
  } catch (err) {
    console.error(`[WarRoom Client] Error starting scan for ${ticker}:`, err);
    showToast(`Scan trigger failed: ${err.message}`);
  }
}

function startScanTracking(scanData) {
  activeScanState = {
    isScanning: true,
    clusterId: scanData.clusterId,
    clusterName: scanData.clusterName,
    tickers: scanData.tickers || [],
    startedAt: Date.now()
  };

  const banner = document.getElementById('live-scan-banner');
  const bannerCluster = document.getElementById('banner-cluster-name');
  const bannerTickers = document.getElementById('banner-tickers-list');
  const bannerTimer = document.getElementById('banner-elapsed');

  if (banner) {
    banner.classList.remove('hidden');
    if (bannerCluster) bannerCluster.textContent = `⚡ SENTIMENT SCAN IN PROGRESS // ${activeScanState.clusterName.toUpperCase()}`;
    if (bannerTickers) bannerTickers.textContent = `Target Assets: [ ${activeScanState.tickers.join(', ')} ] via Tier 1, 2, & 3 Harvesters`;
  }

  // Update Ribbon
  const sentStatusEl = document.getElementById('sentiment-status');
  const scanSubEl = document.getElementById('scan-sub');
  if (sentStatusEl) sentStatusEl.innerHTML = '<span class="status-dot pulsing"></span> SCANNING';
  if (scanSubEl) scanSubEl.textContent = `${activeScanState.clusterName} active`;

  // Start live timer
  if (scanTimerInterval) clearInterval(scanTimerInterval);
  const startTime = Date.now();
  scanTimerInterval = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (bannerTimer) bannerTimer.textContent = `${elapsed}s`;
  }, 100);

  // Trigger UI and D3 re-render for pulsing states
  renderMatrix();
  if (currentPortfolio) renderD3Swarm(currentPortfolio);

  // Poll scan status every 1.5s
  if (scanPollInterval) clearInterval(scanPollInterval);
  scanPollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/plugins/war-room/scan-status');
      const statusData = await res.json();

      if (!statusData.isScanning) {
        clearInterval(scanPollInterval);
        clearInterval(scanTimerInterval);
        scanPollInterval = null;
        scanTimerInterval = null;

        const finishedClusterName = activeScanState.clusterName;
        activeScanState = {
          isScanning: false,
          clusterId: null,
          clusterName: null,
          tickers: [],
          startedAt: null
        };

        if (banner) banner.classList.add('hidden');
        showToast(`⚡ Scan Complete! Signals merged for ${finishedClusterName}.`);

        // Reload fresh portfolio state immediately
        await loadPortfolio(false);
      }
    } catch (pollErr) {
      console.warn('[WarRoom Client] Error polling scan status:', pollErr);
    }
  }, 1500);
}

/* ========================================================
   MATRIX RENDERING
======================================================== */

/* ========================================================
   DETERMINISTIC INLINE 24H SVG SPARKLINES & SECTOR NAV
======================================================== */
function generateSparklineSvg(ticker, changePct, historicalPoints) {
  const w = 54;
  const h = 18;
  const isPos = changePct >= 0;
  const strokeColor = isPos ? '#10b981' : '#f43f5e';
  const cleanTicker = (ticker || 'STK').replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `spark-grad-${cleanTicker}-${isPos ? 'pos' : 'neg'}`;

  let points = [];
  if (Array.isArray(historicalPoints) && historicalPoints.length >= 6) {
    const min = Math.min(...historicalPoints);
    const max = Math.max(...historicalPoints);
    const range = max - min || 1;
    points = historicalPoints.map((val, idx) => {
      const x = (idx / (historicalPoints.length - 1)) * (w - 4) + 2;
      const y = h - 2 - ((val - min) / range) * (h - 4);
      return { x, y };
    });
  } else {
    // Deterministic 12-point synthetic intraday curve seeded by ticker symbol
    let hash = 0;
    for (let i = 0; i < cleanTicker.length; i++) {
      hash = (hash << 5) - hash + cleanTicker.charCodeAt(i);
      hash |= 0;
    }
    const rng = () => {
      hash = (hash * 1103515245 + 12345) & 0x7fffffff;
      return (hash % 1000) / 1000;
    };

    const numPts = 12;
    const trend = isPos ? 1 : -1;
    let cur = 50;
    const raw = [cur];
    for (let i = 1; i < numPts; i++) {
      const step = (rng() - 0.48) * 12 + trend * (Math.abs(changePct) * 0.9 + 1.5);
      cur = Math.max(10, Math.min(90, cur + step));
      raw.push(cur);
    }
    if (isPos && raw[raw.length - 1] <= raw[0]) raw[raw.length - 1] = raw[0] + 16;
    if (!isPos && raw[raw.length - 1] >= raw[0]) raw[raw.length - 1] = raw[0] - 16;

    const min = Math.min(...raw);
    const max = Math.max(...raw);
    const range = max - min || 1;
    points = raw.map((val, idx) => {
      const x = (idx / (numPts - 1)) * (w - 4) + 2;
      const y = h - 2 - ((val - min) / range) * (h - 4);
      return { x, y };
    });
  }

  const pathD = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${w - 2} ${h} L 2 ${h} Z`;

  return `
    <svg class="ticker-sparkline" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <path d="${areaD}" fill="url(#${gradId})" />
      <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function renderSectorNav(clusters) {
  const nav = document.getElementById('sector-nav-ribbon');
  if (!nav || !clusters) return;

  const shortNames = {
    1: 'Defense',
    2: 'Energy',
    3: 'Power & Utils',
    4: 'Healthcare',
    5: 'Nuclear',
    6: 'Big Tech',
    7: 'Next-Gen',
    8: 'Crypto'
  };

  nav.innerHTML = clusters.map(cluster => {
    const color = CLUSTER_COLORS[cluster.id] || '#00e5ff';
    const label = shortNames[cluster.id] || cluster.name.split('&')[0].trim();
    return `
      <button class="sector-nav-pill" id="sector-nav-pill-${cluster.id}" data-cluster-id="${cluster.id}">
        <span class="sector-dot" style="background: ${color}; box-shadow: 0 0 6px ${color};"></span>
        <span class="sector-label">#${cluster.id} ${label}</span>
        <span class="sector-count-badge">
          <span class="owned">${cluster.owned_count}O</span> / <span class="watch">${cluster.watchlist_count}W</span>
        </span>
      </button>
    `;
  }).join('');

  nav.querySelectorAll('.sector-nav-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const cId = btn.dataset.clusterId;
      const targetCard = document.getElementById(`cluster-card-${cId}`);
      if (targetCard) {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        targetCard.classList.add('cluster-focus-pulse');
        setTimeout(() => targetCard.classList.remove('cluster-focus-pulse'), 1500);
        highlightSectorPill(cId);
      }
    });
  });
}

function highlightSectorPill(clusterId, highlight = true) {
  document.querySelectorAll('.sector-nav-pill').forEach(p => p.classList.remove('active'));
  if (highlight) {
    const active = document.getElementById(`sector-nav-pill-${clusterId}`);
    if (active) active.classList.add('active');
  }
}

function highlightRadarNode(clusterId, highlight = true) {
  if (typeof d3 === 'undefined') return;
  const node = d3.select(`#radar-node-${clusterId}`);
  if (!node.empty()) {
    node.select('.cluster-outer-ring')
      .transition().duration(150)
      .attr('stroke-width', highlight ? 4 : 2)
      .style('filter', highlight ? 'drop-shadow(0 0 10px #00e5ff)' : 'none');
  }
}


function renderMatrix() {
  if (!currentPortfolio) return;
  const container = document.getElementById('clusters-container');
  if (!container) return;

  container.innerHTML = '';
  const clusters = currentPortfolio.clusters || [];

  // Update Sector Navigator Ribbon dynamically
  renderSectorNav(clusters);

  clusters.forEach(cluster => {
    let filteredAssets = (cluster.assets || []).filter(asset => {
      if (activeFilter === 'owned' && !asset.owned) return false;
      if (activeFilter === 'watchlist' && asset.owned) return false;

      if (searchQuery) {
        const matchesTicker = asset.ticker.toLowerCase().includes(searchQuery);
        const matchesName = asset.name.toLowerCase().includes(searchQuery);
        const matchesCluster = cluster.name.toLowerCase().includes(searchQuery);
        if (!matchesTicker && !matchesName && !matchesCluster) return false;
      }
      return true;
    });

    if (filteredAssets.length === 0 && (searchQuery || activeFilter !== 'all')) {
      return;
    }

    const clusterColor = CLUSTER_COLORS[cluster.id] || '#38bdf8';
    const isClusterScanning = activeScanState.isScanning && activeScanState.clusterId === cluster.id;

    const card = document.createElement('div');
    card.className = `cluster-card ${isClusterScanning ? 'scanning-active' : ''}`;
    card.id = `cluster-card-${cluster.id}`;
    card.style.setProperty('--cluster-color', clusterColor);

    // Bidirectional hover linkage with Sector Nav & Radar
    card.addEventListener('mouseenter', () => {
      highlightSectorPill(cluster.id, true);
      highlightRadarNode(cluster.id, true);
    });
    card.addEventListener('mouseleave', () => {
      highlightSectorPill(cluster.id, false);
      highlightRadarNode(cluster.id, false);
    });

    // Header with [⚡ SCAN CLUSTER] button
    const header = document.createElement('div');
    header.className = 'cluster-header';
    header.innerHTML = `
      <div class="cluster-title-group">
        <span class="cluster-name" title="${cluster.name}">${cluster.name}</span>
        <span class="cluster-meta">Cluster #${cluster.id} // ${cluster.owned_count} Owned &bull; ${cluster.watchlist_count} Watch</span>
      </div>

      <div class="cluster-header-controls">
        <button 
          class="scan-cluster-btn ${isClusterScanning ? 'scanning' : ''}" 
          id="btn-scan-cluster-${cluster.id}"
          data-cluster-id="${cluster.id}"
          ${activeScanState.isScanning ? 'disabled' : ''}
          title="Scan sentiment for all ${cluster.assets.length} assets in this cluster">
          ${isClusterScanning ? '⚡ SCANNING...' : '⚡ SCAN CLUSTER'}
        </button>

        <div class="cluster-value-badge" style="color: ${clusterColor};">
          $${cluster.total_value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
    `;

    const scanBtn = header.querySelector(`#btn-scan-cluster-${cluster.id}`);
    if (scanBtn) {
      scanBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const clusterTickers = (cluster.assets || []).map(a => a.ticker);
        triggerClusterScan(cluster.id, cluster.name, clusterTickers);
      });
    }

    card.appendChild(header);

    // Assets List (Internal Scrollable Container)
    const list = document.createElement('div');
    list.className = 'cluster-assets-list';

    filteredAssets.forEach(asset => {
      const row = document.createElement('div');
      row.className = `stock-row ${asset.owned ? 'owned-active' : ''}`;
      row.id = `row-${asset.ticker}`;

      const changeCls = asset.change_24h_pct >= 0 ? 'pos' : 'neg';
      const changeSign = asset.change_24h_pct >= 0 ? '+' : '';
      const { regimeClass, regimeLabel } = getRegimeBadgeMeta(asset.sentiment_regime);
      const sparklineHtml = generateSparklineSvg(asset.ticker, asset.change_24h_pct, asset.sparkline_points || asset.history_points);

      row.innerHTML = `
        <!-- Col 1: Identity Block -->
        <div class="col-identity ticker-group" title="Click to open Quantitative Recon for ${asset.ticker}">
          <span class="ticker-text">${asset.ticker}</span>
          <span class="badge-tag ${asset.owned ? 'owned' : 'watchlist'}" id="badge-${asset.ticker}">
            ${asset.owned ? 'PORTFOLIO' : 'WATCHLIST'}
          </span>
        </div>

        <!-- Col 2: Inline 24h SVG Sparkline -->
        <div class="col-sparkline">
          ${sparklineHtml}
        </div>

        <!-- Col 3: Price & % Delta Block -->
        <div class="col-price">
          <span class="spot-text">$${asset.spot_price.toFixed(2)}</span>
          <span class="change-pill ${changeCls}">${changeSign}${asset.change_24h_pct.toFixed(2)}%</span>
        </div>

        <!-- Col 4: Shares Input -->
        <div class="col-shares">
          <input 
            type="number" 
            class="shares-input" 
            id="input-${asset.ticker}" 
            data-ticker="${asset.ticker}"
            value="${asset.shares}" 
            min="0" 
            step="any"
            placeholder="0">
        </div>

        <!-- Col 5: Equity Value & Action Micro-Dock & Regime -->
        <div class="col-equity-actions">
          <div class="equity-value-row">
            <span class="pos-val-text ${asset.owned ? 'pos-owned' : 'pos-zero'}" id="val-${asset.ticker}">
              $${asset.position_value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <div class="action-micro-dock">
              <button class="scan-single-btn" data-ticker="${asset.ticker}" data-cluster="${cluster.id}" title="Scan sentiment for ${asset.ticker}" ${activeScanState.isScanning ? 'disabled' : ''}>⚡</button>
              <button class="recon-single-btn" data-ticker="${asset.ticker}" title="Vault Recon for ${asset.ticker}">🎯</button>
              ${!asset.owned && (asset.shares === 0) ? `<button class="archive-single-btn" data-ticker="${asset.ticker}" title="Archive ${asset.ticker} from Watchlist">✕</button>` : ''}
            </div>
          </div>
          <span class="sentiment-pill ${regimeClass}" title="${asset.sentiment_regime} (Risk: ${asset.risk_modifier}x)\n${asset.sentiment_summary || ''}">
            ${regimeLabel} &bull; ${asset.risk_modifier}x
          </span>
        </div>
      `;

      // Attach single scan button event
      const singleScanBtn = row.querySelector('.scan-single-btn');
      if (singleScanBtn) {
        singleScanBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerTickerScan(asset.ticker, cluster.id);
        });
      }

      // Attach single Recon button event
      const singleReconBtn = row.querySelector('.recon-single-btn');
      if (singleReconBtn) {
        singleReconBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          fetchRecon(asset.ticker);
        });
      }

      // Attach Archive button event
      const singleArchiveBtn = row.querySelector('.archive-single-btn');
      if (singleArchiveBtn) {
        singleArchiveBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const targetTicker = asset.ticker;
          if (confirm(`Archive $${targetTicker} from watchlist?
Historical dossier notes will be safely preserved in vault archive.`)) {
            try {
              const res = await fetch('/api/plugins/war-room/universe/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker: targetTicker })
              });
              const data = await res.json();
              if (data.success) {
                showToast(`📦 Archived $${targetTicker} from universe`);
                await loadPortfolio(true);
              } else {
                showToast(data.error || 'Failed to archive ticker');
              }
            } catch (err) {
              console.error('Archive error:', err);
              showToast('Error archiving ticker');
            }
          }
        });
      }

      // Attach click event to ticker-group to also open Recon
      const tickerGroup = row.querySelector('.col-identity');
      if (tickerGroup) {
        tickerGroup.addEventListener('click', (e) => {
          e.stopPropagation();
          fetchRecon(asset.ticker);
        });
      }

      // Attach inline input events
      const input = row.querySelector('.shares-input');
      if (input) {
        input.addEventListener('change', () => handleShareUpdate(asset.ticker, input.value, input));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
        });
      }

      list.appendChild(row);
    });

    card.appendChild(list);
    container.appendChild(card);
  });
}

function getRegimeBadgeMeta(regime) {
  if (!regime || regime === 'UNSCANNED') {
    return { regimeClass: 'unscanned', regimeLabel: 'UNSCANNED' };
  }
  const clean = regime.replace(/_/g, ' ');
  if (regime.includes('BULLISH')) {
    return { regimeClass: 'bullish', regimeLabel: clean };
  }
  if (regime.includes('ACCUMULATION') || regime.includes('STEADY')) {
    return { regimeClass: 'steady', regimeLabel: clean };
  }
  return { regimeClass: 'steady', regimeLabel: clean };
}

async function handleShareUpdate(ticker, value, inputEl) {
  const sharesNum = Math.max(0, parseFloat(value) || 0);
  try {
    const res = await fetch('/api/plugins/war-room/update-shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, shares: sharesNum })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error);

    // Visual Flash Feedback
    inputEl.classList.add('save-flash');
    setTimeout(() => inputEl.classList.remove('save-flash'), 800);

    // Update Row Local DOM
    const row = document.getElementById(`row-${ticker}`);
    const badge = document.getElementById(`badge-${ticker}`);
    const valText = document.getElementById(`val-${ticker}`);

    if (row && badge && valText) {
      if (result.owned) {
        row.classList.add('owned-active');
        badge.className = 'badge-tag owned';
        badge.textContent = 'PORTFOLIO';
      } else {
        row.classList.remove('owned-active');
        badge.className = 'badge-tag watchlist';
        badge.textContent = 'WATCHLIST';
      }
      valText.textContent = `$${result.position_value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    showToast(`Saved ${ticker}: ${result.shares} shares (${result.owned ? 'Portfolio' : 'Watchlist'})`);

    // Reload entire portfolio in background to update Ribbon and cluster totals
    loadPortfolio(false);
  } catch (err) {
    console.error(`Failed to update ${ticker}:`, err);
    showToast(`Error updating ${ticker}`);
  }
}

function showToast(msg) {
  const toast = document.getElementById('save-toast');
  if (toast) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  }
}

/* ========================================================
   D3 INTERACTIVE CONSTELLATION & LIVE SCAN RADAR SCENE (TILE 3)
======================================================== */
function renderD3Swarm(data) {
  const container = document.getElementById('d3-swarm-canvas');
  if (!container || !window.d3) return;

  container.innerHTML = '';
  const width = container.clientWidth || 380;
  const height = 275;

  const svg = d3.select('#d3-swarm-canvas')
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const g = svg.append('g');

  const centerX = width / 2;
  const centerY = height / 2;

  // Concentric Radar Scope Range Rings & Crosshairs
  const maxR = Math.min(width * 0.42, height * 0.40);
  [maxR * 0.35, maxR * 0.70, maxR * 1.0].forEach(r => {
    g.append('circle')
      .attr('cx', centerX)
      .attr('cy', centerY)
      .attr('r', r)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(0, 229, 255, 0.12)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4');
  });

  g.append('line')
    .attr('x1', centerX - maxR * 1.05)
    .attr('y1', centerY)
    .attr('x2', centerX + maxR * 1.05)
    .attr('y2', centerY)
    .attr('stroke', 'rgba(0, 229, 255, 0.08)')
    .attr('stroke-width', 1);

  g.append('line')
    .attr('x1', centerX)
    .attr('y1', centerY - maxR * 0.85)
    .attr('x2', centerX)
    .attr('y2', centerY + maxR * 0.85)
    .attr('stroke', 'rgba(0, 229, 255, 0.08)')
    .attr('stroke-width', 1);


  // Build cluster nodes
  const clusterNodes = (data.clusters || []).map((c, i) => {
    const angle = (i / 8) * (2 * Math.PI) - Math.PI / 2;
    const radius = Math.min(width * 0.42, height * 0.40);
    const isScanning = activeScanState.isScanning && activeScanState.clusterId === c.id;
    return {
      id: `cluster-${c.id}`,
      type: 'cluster',
      clusterId: c.id,
      name: c.name,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * (radius * 0.76),
      color: CLUSTER_COLORS[c.id] || '#38bdf8',
      totalValue: c.total_value,
      ownedCount: c.owned_count,
      isScanning: isScanning,
      assets: c.assets || []
    };
  });

  // Connecting Lines from Center Core to Clusters
  g.selectAll('.core-link')
    .data(clusterNodes)
    .enter()
    .append('line')
    .attr('class', 'core-link')
    .attr('x1', centerX)
    .attr('y1', centerY)
    .attr('x2', d => d.x)
    .attr('y2', d => d.y)
    .attr('stroke', d => d.isScanning ? '#c084fc' : d.color)
    .attr('stroke-width', d => d.isScanning ? 2.5 : 1)
    .attr('stroke-dasharray', d => d.isScanning ? '5,5' : '3,3')
    .attr('opacity', d => d.isScanning ? 0.9 : 0.35);

  // Center Core Node
  const core = g.append('g')
    .attr('transform', `translate(${centerX}, ${centerY})`);

  core.append('circle')
    .attr('r', 18)
    .attr('fill', '#0c1018')
    .attr('stroke', activeScanState.isScanning ? '#c084fc' : '#38bdf8')
    .attr('stroke-width', 2);

  core.append('circle')
    .attr('r', 8)
    .attr('fill', activeScanState.isScanning ? '#c084fc' : '#38bdf8')
    .attr('opacity', 0.85);

  core.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', 28)
    .attr('fill', activeScanState.isScanning ? '#c084fc' : '#38bdf8')
    .attr('font-size', '8.5px')
    .attr('font-family', 'monospace')
    .attr('font-weight', '700')
    .text(activeScanState.isScanning ? 'HARVESTING...' : 'WAR ROOM CORE');

  // Render Cluster Nodes
  const clustersGroup = g.selectAll('.cluster-node')
    .data(clusterNodes)
    .enter()
    .append('g')
    .attr('class', 'cluster-node')
    .attr('id', d => `radar-node-${d.clusterId}`)
    .attr('transform', d => `translate(${d.x}, ${d.y})`)
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      const targetCard = document.getElementById(`cluster-card-${d.clusterId}`);
      if (targetCard) {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        targetCard.classList.add('cluster-focus-pulse');
        setTimeout(() => targetCard.classList.remove('cluster-focus-pulse'), 1500);
        highlightSectorPill(d.clusterId);
      }
    })
    .on('mouseenter', (event, d) => {
      highlightSectorPill(d.clusterId, true);
    })
    .on('mouseleave', (event, d) => {
      highlightSectorPill(d.clusterId, false);
    });

  // Animated Radar Wave for Scanning Node
  clustersGroup.filter(d => d.isScanning)
    .append('circle')
    .attr('r', 26)
    .attr('fill', 'none')
    .attr('stroke', '#c084fc')
    .attr('stroke-width', 2)
    .attr('opacity', 0.8)
    .append('animate')
    .attr('attributeName', 'r')
    .attr('values', '16;32;16')
    .attr('dur', '1.6s')
    .attr('repeatCount', 'indefinite');

  clustersGroup.filter(d => d.isScanning)
    .append('circle')
    .attr('r', 18)
    .attr('fill', 'rgba(192, 132, 252, 0.25)')
    .append('animate')
    .attr('attributeName', 'opacity')
    .attr('values', '0.2;0.8;0.2')
    .attr('dur', '1.6s')
    .attr('repeatCount', 'indefinite');

  // Cluster Outer Ring
  clustersGroup.append('circle')
    .attr('class', 'cluster-outer-ring')
    .attr('r', d => 14 + (d.ownedCount > 0 ? 3 : 0))
    .attr('fill', '#090d15')
    .attr('stroke', d => d.isScanning ? '#c084fc' : d.color)
    .attr('stroke-width', d => d.isScanning ? 3 : 2)
    .attr('opacity', 0.9);

  // Cluster Inner Pulse
  clustersGroup.append('circle')
    .attr('r', 5)
    .attr('fill', d => d.isScanning ? '#c084fc' : d.color)
    .attr('opacity', d => d.ownedCount > 0 || d.isScanning ? 1 : 0.6);

  // Cluster Short Clean Labels (Bugfixed: No truncated strings)
  clustersGroup.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', 24)
    .attr('fill', d => d.isScanning ? '#c084fc' : '#f1f5f9')
    .attr('font-size', '8.5px')
    .attr('font-weight', d => d.isScanning ? '800' : '600')
    .attr('font-family', 'monospace')
    .text(d => d.isScanning ? `⚡ SCANNING` : (CLUSTER_SHORT_NAMES[d.clusterId] || d.name.split(' ')[0]));

  // Asset Mini Orbiters
  const assetNodes = [];
  clusterNodes.forEach(c => {
    (c.assets || []).forEach((asset, idx) => {
      const offsetAngle = (idx / c.assets.length) * 2 * Math.PI;
      const dist = 22;
      assetNodes.push({
        ticker: asset.ticker,
        clusterColor: c.color,
        owned: asset.owned,
        regime: asset.sentiment_regime,
        x: c.x + Math.cos(offsetAngle) * dist,
        y: c.y + Math.sin(offsetAngle) * dist
      });
    });
  });

  g.selectAll('.asset-dot')
    .data(assetNodes)
    .enter()
    .append('circle')
    .attr('class', 'asset-dot')
    .attr('cx', d => d.x)
    .attr('cy', d => d.y)
    .attr('r', d => d.owned ? 3.0 : 1.8)
    .attr('fill', d => {
      if (d.regime && d.regime.includes('BULLISH')) return '#10b981';
      if (d.regime && d.regime.includes('STEADY')) return '#f59e0b';
      return d.clusterColor;
    })
    .attr('stroke', d => d.owned ? '#f8fafc' : 'none')
    .attr('stroke-width', d => d.owned ? 1 : 0)
    .attr('opacity', d => d.owned ? 1 : 0.7)
    .append('title')
    .text(d => `${d.ticker} (${d.owned ? 'PORTFOLIO' : 'WATCHLIST'})\nRegime: ${d.regime}`);
}

window.setJulieSpeaking = function(val) { if (window.julieVisualizer) window.julieVisualizer.setSpeaking(val); };
