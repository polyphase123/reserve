// ============================================================================
// PHILIPPINE GRID SIMULATOR — MOBILE-FIRST CONTROLLER
// Real-Time 60 FPS Physics, Dynamic Outages, WESM Reserves & Bill Calculator
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  // Initialize Core Physics Engine
  const sim = new GridPhysicsSimulator();
  
  // App State
  let currentRegionKey = "luzon";
  let audioEnabled = true;
  let waveformPhase = 0;
  let activeScopeView = "wave"; // "wave" or "trend"
  let selectedMonthlyKWh = 200;

  // Cumulative Payouts & Penalties in PHP
  const sessionFinancials = {
    totalPaid: 0,
    baseloadPaid: 0,
    midmeritPaid: 0,
    peakingPaid: 0,
    ffrPaid: 0,
    regPaid: 0,
    spinPaid: 0,
    nonSpinPaid: 0,
    ercPenaltyAccrued: 0,
    currentPenaltyRatePerHour: 0
  };
  
  // Sound Synthesizer (Reused AudioContext for 100% iOS Safari & Android support)
  let sharedAudioCtx = null;
  function getAudioCtx() {
    if (!sharedAudioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        sharedAudioCtx = new AudioCtxClass();
      }
    }
    if (sharedAudioCtx && sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume();
    }
    return sharedAudioCtx;
  }

  window.addEventListener("touchstart", () => getAudioCtx(), { once: true, passive: true });
  window.addEventListener("click", () => getAudioCtx(), { once: true, passive: true });

  function playBeep(freq = 440, type = "sine", duration = 0.1) {
    if (!audioEnabled) return;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }

  // --- REAL-TIME SCADA / WESM DISPATCH TERMINAL LOGGER ---
  const terminalBody = document.getElementById("terminal-body");
  const terminalClock = document.getElementById("terminal-clock");
  const terminalMaxLines = 80;

  function logTerminal(tag, message, tagClass = "term-tag-info") {
    if (!terminalBody) return;
    const timeStr = `T+${sim.time.toFixed(1)}s`;
    const line = document.createElement("div");
    line.className = "term-line";
    line.innerHTML = `
      <span class="term-time">${timeStr}</span>
      <span class="term-tag ${tagClass}">${tag}</span>
      <span class="term-msg">${message}</span>
    `;
    terminalBody.appendChild(line);

    while (terminalBody.children && terminalBody.children.length > terminalMaxLines) {
      terminalBody.removeChild(terminalBody.children[0]);
    }

    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  document.getElementById("btn-clear-terminal")?.addEventListener("click", () => {
    if (terminalBody) terminalBody.innerHTML = "";
    logTerminal("SYSTEM", "Terminal log cleared by operator.", "term-tag-info");
  });

  // Seed Initial Terminal Logs
  logTerminal("SCADA", "NGCP Energy Management System (EMS) & AGC Online.", "term-tag-info");
  logTerminal("WESM", "Ex-Ante Co-Optimization Engine Synchronized. 1s = 5-min RTM.", "term-tag-wesm");
  logTerminal("GRID", "Nominal frequency 60.000 Hz. All primary & secondary reserves ready.", "term-tag-dispatch");

  // --- CANVASES INITIALIZATION (HIGH-DPI RETINA SCALED) ---
  const waveCanvas = document.getElementById("waveformCanvas");
  const waveCtx = waveCanvas ? waveCanvas.getContext("2d") : null;

  const freqCanvas = document.getElementById("freqHistoryCanvas");
  const freqCtx = freqCanvas ? freqCanvas.getContext("2d") : null;

  let dpr = window.devicePixelRatio || 1;
  let lastWaveW = 0, lastWaveH = 0, lastFreqW = 0, lastFreqH = 0;

  function resizeCanvases() {
    dpr = window.devicePixelRatio || 1;

    if (waveCanvas && waveCanvas.parentElement) {
      const rect = waveCanvas.parentElement.getBoundingClientRect();
      const displayW = Math.max(180, Math.floor(rect.width));
      const displayH = Math.max(80, Math.floor(rect.height || 125));
      if (displayW !== lastWaveW || displayH !== lastWaveH) {
        lastWaveW = displayW;
        lastWaveH = displayH;
        waveCanvas.width = displayW * dpr;
        waveCanvas.height = displayH * dpr;
      }
    }

    if (freqCanvas && freqCanvas.parentElement) {
      const rect = freqCanvas.parentElement.getBoundingClientRect();
      const displayW = Math.max(180, Math.floor(rect.width));
      const displayH = Math.max(80, Math.floor(rect.height || 125));
      if (displayW !== lastFreqW || displayH !== lastFreqH) {
        lastFreqW = displayW;
        lastFreqH = displayH;
        freqCanvas.width = displayW * dpr;
        freqCanvas.height = displayH * dpr;
      }
    }
  }

  window.addEventListener("resize", resizeCanvases, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvases, 150));
  resizeCanvases();
  setTimeout(resizeCanvases, 100);

  // --- DYNAMIC REGIONAL POWER PLANTS & OUTAGE BUTTONS ---
  function renderRegionalOutageButtons(regionKey) {
    const container = document.getElementById("regional-trip-buttons");
    if (!container) return;
    container.innerHTML = "";

    const plantList = (typeof REGIONAL_POWER_PLANTS !== "undefined" && REGIONAL_POWER_PLANTS[regionKey]) 
      ? REGIONAL_POWER_PLANTS[regionKey] 
      : [];

    plantList.forEach(plant => {
      const isTripped = sim.activeOutages.some(p => p.id === plant.id);
      const btn = document.createElement("button");
      btn.id = `btn-plant-${plant.id}`;
      btn.className = `plant-btn ${isTripped ? "plant-btn-tripped" : (plant.category === "Grid Storm" ? "plant-btn-storm" : "plant-btn-danger")}`;
      
      let badgeClass = "badge-red";
      if (plant.category === "RE Solar Drop") badgeClass = "badge-amber";
      if (plant.category === "N-1 Benchmark") badgeClass = "badge-red";

      const shortDocket = plant.ercCaseNumber ? plant.ercCaseNumber.replace("ERC Case No. ", "ERC ") : "ERC Case";

      btn.innerHTML = `
        <div class="plant-btn-title">
          <span>${plant.name} (-${plant.mw}M)</span>
          <span class="btn-trip-erc-badge" title="View Official ERC Case" onclick="event.stopPropagation(); window.openPlantModal('${plant.id}');">
            ⚖️ ${shortDocket}
          </span>
        </div>
        <div class="plant-btn-sub">${plant.location} • ${plant.fuel}</div>
        <div class="plant-btn-rate">
          <span>${plant.defaultRate || "₱850/MW-h"}</span>
          <span class="${isTripped ? 'plant-restore-cta' : 'plant-trip-cta'}">
            ${isTripped ? "🔄 RESTORE" : "⚡ CLICK TO TRIP"}
          </span>
        </div>
      `;

      btn.addEventListener("click", () => {
        const currentlyTripped = sim.activeOutages.some(p => p.id === plant.id);
        const ctaSpan = btn.querySelector(".plant-btn-rate span:last-child");
        if (currentlyTripped) {
          sim.untripPlant(plant.id);
          btn.className = `plant-btn ${plant.category === "Grid Storm" ? "plant-btn-storm" : "plant-btn-danger"}`;
          if (ctaSpan) {
            ctaSpan.className = "plant-trip-cta";
            ctaSpan.textContent = "⚡ CLICK TO TRIP";
          }
          logTerminal("PLANT-RESTORE", `✓ <strong>${plant.name}</strong> restored & resynchronized (+${plant.mw} MW).`, "term-tag-info");
          playBeep(520, "sine", 0.12);
        } else {
          sim.tripPlant(plant);
          btn.className = "plant-btn plant-btn-tripped";
          if (ctaSpan) {
            ctaSpan.className = "plant-restore-cta";
            ctaSpan.textContent = "🔄 RESTORE";
          }
          logTerminal("PLANT-TRIP", `💥 <strong>${plant.name}</strong> FORCED OUTAGE (-${plant.mw} MW)! Total Lost: <strong>-${sim.trippedPlantMW} MW</strong>.`, "term-tag-alert");
          logTerminal("ERC-AUDIT", `⚖️ Unplanned trip under <strong>${plant.ercCaseNumber || "ERC Res 10-2020"}</strong>. Fine: ₱${(plant.unexcusedPenaltyPerHour || 125000).toLocaleString()}/hr.`, "term-tag-erc");
          playBeep(180, "sawtooth", 0.45);
        }
        updateTrippedBadge();
      });

      container.appendChild(btn);
    });

    updateTrippedBadge();
    updateCardTripButtonsUI();
  }

  function getRegionalPlantForUnit(unitKey) {
    const region = REGIONAL_GRIDS[currentRegionKey] || REGIONAL_GRIDS.luzon;
    const p = region.plants;
    if (unitKey === "baseload" && p.baseload) return { id: p.baseload.id || "gnpower_dinginin", name: p.baseload.name, mw: p.baseload.capacityMW || 668, ercCaseNumber: p.baseload.ercCaseNumber, unexcusedPenaltyPerHour: p.baseload.unexcusedPenaltyPerHour };
    if (unitKey === "midmerit" && p.midmerit) return { id: p.midmerit.id || "ilijan_ccgt", name: p.midmerit.name, mw: p.midmerit.capacityMW || 600, ercCaseNumber: p.midmerit.ercCaseNumber, unexcusedPenaltyPerHour: p.midmerit.unexcusedPenaltyPerHour };
    if (unitKey === "peaking" && p.peaking) return { id: p.peaking.id || "limay_peaker", name: p.peaking.name, mw: p.peaking.capacityMW || 300, ercCaseNumber: p.peaking.ercCaseNumber, unexcusedPenaltyPerHour: p.peaking.unexcusedPenaltyPerHour };
    if (unitKey === "ffr" && p.ffr) return { id: p.ffr.id || "masinloc_bess", name: p.ffr.name, mw: p.ffr.capacityMW || 150, ercCaseNumber: p.ffr.ercCaseNumber, unexcusedPenaltyPerHour: p.ffr.unexcusedPenaltyPerHour };
    if (unitKey === "reg" && p.reg) return { id: p.reg.id || "magat_hydro", name: p.reg.name, mw: p.reg.capacityMW || 200, ercCaseNumber: p.reg.ercCaseNumber, unexcusedPenaltyPerHour: p.reg.unexcusedPenaltyPerHour };
    if (unitKey === "spin" && p.spin) return { id: p.spin.id || "pagbilao_coal", name: p.spin.name, mw: p.spin.capacityMW || 400, ercCaseNumber: p.spin.ercCaseNumber, unexcusedPenaltyPerHour: p.spin.unexcusedPenaltyPerHour };
    if (unitKey === "nonspin" && p.nonspin) return { id: p.nonspin.id || "malaya_peaker", name: p.nonspin.name, mw: p.nonspin.capacityMW || 300, ercCaseNumber: p.nonspin.ercCaseNumber, unexcusedPenaltyPerHour: p.nonspin.unexcusedPenaltyPerHour };
    return null;
  }

  function updateCardTripButtonsUI() {
    const unitKeys = ["baseload", "midmerit", "peaking", "ffr", "reg", "spin", "nonspin"];
    unitKeys.forEach(key => {
      const btn = document.getElementById(`btn-trip-card-${key}`);
      if (!btn) return;
      const plant = getRegionalPlantForUnit(key);
      if (!plant) return;
      const isTripped = sim.activeOutages.some(p => p.id === plant.id);
      if (isTripped) {
        btn.className = "btn btn-sm btn-trip-card-unit is-tripped";
        btn.innerHTML = `🔄 RESTORE UNIT`;
      } else {
        btn.className = "btn btn-sm btn-danger btn-trip-card-unit";
        btn.innerHTML = `⚡ CLICK TO TRIP`;
      }
    });
  }

  function updateTrippedBadge() {
    const badge = document.getElementById("tripped-total-badge");
    if (!badge) return;
    if (sim.trippedPlantMW > 0) {
      badge.className = "badge badge-red";
      badge.textContent = `🚨 -${sim.trippedPlantMW.toFixed(0)} MW LOST`;
    } else {
      badge.className = "badge badge-green";
      badge.textContent = "0 MW TRIPPED";
    }
    updateCardTripButtonsUI();
  }

  // --- REGIONAL GRID SELECTOR LOGIC ---
  function setRegionalGrid(regionKey) {
    currentRegionKey = regionKey;
    const region = REGIONAL_GRIDS[regionKey] || REGIONAL_GRIDS.luzon;
    
    // Update Button Styles
    ["luzon", "visayas", "mindanao"].forEach(k => {
      const btn = document.getElementById(`btn-grid-${k}`);
      if (btn) {
        if (k === regionKey) btn.classList.add("active-region");
        else btn.classList.remove("active-region");
      }
    });

    // Reset Sim Parameters for Region
    sim.totalLoad = region.baseDemandMW;
    sim.totalGen = region.baseDemandMW;
    sim.systemBaseMVA = region.baseDemandMW * 1.35;
    sim.clearContingency();
    sim.restoreMLD();

    // Scale Reserves for Regional Grid size
    if (regionKey === "luzon") {
      sim.ffrCapacity = 150;
      sim.regCapacity = 200;
      sim.spinCapacity = 400;
      sim.nonSpinCapacity = 300;
    } else if (regionKey === "visayas") {
      sim.ffrCapacity = 50;
      sim.regCapacity = 80;
      sim.spinCapacity = 100;
      sim.nonSpinCapacity = 80;
    } else if (regionKey === "mindanao") {
      sim.ffrCapacity = 50;
      sim.regCapacity = 120;
      sim.spinCapacity = 100;
      sim.nonSpinCapacity = 200;
    }

    // Update Header Tagline & Names
    const taglineElem = document.getElementById("grid-region-tagline");
    if (taglineElem) taglineElem.textContent = `${region.name} (${(region.baseDemandMW/1000).toFixed(1)} GW Peak)`;

    const p = region.plants;
    if (document.getElementById("plant-name-baseload")) document.getElementById("plant-name-baseload").textContent = `🏭 ${p.baseload.name}`;
    if (p.midmerit && document.getElementById("plant-name-midmerit")) document.getElementById("plant-name-midmerit").textContent = `🔥 ${p.midmerit.name}`;
    if (p.peaking && document.getElementById("plant-name-peaking")) document.getElementById("plant-name-peaking").textContent = `🚢 ${p.peaking.name}`;
    if (p.ffr && document.getElementById("plant-name-ffr")) document.getElementById("plant-name-ffr").textContent = `🔋 ${p.ffr.name}`;
    if (p.reg && document.getElementById("plant-name-reg")) document.getElementById("plant-name-reg").textContent = `💧 ${p.reg.name}`;
    if (p.spin && document.getElementById("plant-name-spin")) document.getElementById("plant-name-spin").textContent = `⚡ ${p.spin.name}`;
    if (p.nonspin && document.getElementById("plant-name-nonspin")) document.getElementById("plant-name-nonspin").textContent = `🚢 ${p.nonspin.name}`;

    // Update Specific Plant Names in Active Reserves Reaction Boxes
    if (p.ffr && document.getElementById("res-plant-name-ffr")) document.getElementById("res-plant-name-ffr").textContent = `${p.ffr.name} (${p.ffr.capacityMW} MW)`;
    if (p.reg && document.getElementById("res-plant-name-reg")) document.getElementById("res-plant-name-reg").textContent = `${p.reg.name} (${p.reg.capacityMW} MW)`;
    if (p.spin && document.getElementById("res-plant-name-spin")) document.getElementById("res-plant-name-spin").textContent = `${p.spin.name} (${p.spin.capacityMW} MW)`;
    if (p.nonspin && document.getElementById("res-plant-name-nonspin")) document.getElementById("res-plant-name-nonspin").textContent = `${p.nonspin.name} (${p.nonspin.capacityMW} MW)`;

    // Update Vertical Stack Bar Sub-Labels
    const shortName = (name) => name ? name.split(" ")[0].replace(/[^a-zA-Z0-9]/g, "") : "";
    if (p.baseload && document.getElementById("vbar-sub-baseload")) document.getElementById("vbar-sub-baseload").textContent = shortName(p.baseload.name);
    if (p.midmerit && document.getElementById("vbar-sub-midmerit")) document.getElementById("vbar-sub-midmerit").textContent = shortName(p.midmerit.name);
    if (p.peaking && document.getElementById("vbar-sub-peaking")) document.getElementById("vbar-sub-peaking").textContent = shortName(p.peaking.name);
    if (p.ffr && document.getElementById("vbar-sub-ffr")) document.getElementById("vbar-sub-ffr").textContent = shortName(p.ffr.name);
    if (p.reg && document.getElementById("vbar-sub-reg")) document.getElementById("vbar-sub-reg").textContent = shortName(p.reg.name);
    if (p.spin && document.getElementById("vbar-sub-spin")) document.getElementById("vbar-sub-spin").textContent = shortName(p.spin.name);
    if (p.nonspin && document.getElementById("vbar-sub-nonspin")) document.getElementById("vbar-sub-nonspin").textContent = shortName(p.nonspin.name);

    renderRegionalOutageButtons(regionKey);
    playBeep(580, "sine", 0.1);
  }

  document.getElementById("btn-grid-luzon")?.addEventListener("click", () => setRegionalGrid("luzon"));
  document.getElementById("btn-grid-visayas")?.addEventListener("click", () => setRegionalGrid("visayas"));
  document.getElementById("btn-grid-mindanao")?.addEventListener("click", () => setRegionalGrid("mindanao"));

  // --- APP TABS SWITCHER (1-SCREEN MOBILE NAVIGATION) ---
  const navTabBtns = document.querySelectorAll(".nav-tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  navTabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTabId = btn.getAttribute("data-tab");
      navTabBtns.forEach(b => b.classList.remove("active-tab"));
      btn.classList.add("active-tab");

      tabPanes.forEach(pane => {
        if (pane.id === targetTabId) {
          pane.style.display = "block";
          pane.classList.add("active-pane");
        } else {
          pane.style.display = "none";
          pane.classList.remove("active-pane");
        }
      });

      if (targetTabId === "tab-sim") {
        setTimeout(resizeCanvases, 50);
      }
      playBeep(540, "sine", 0.06);
    });
  });

  // --- 1. OSCILLOSCOPE AC WAVEFORM RENDERER ---
  function drawWaveform(currentFreq) {
    if (!waveCtx || !waveCanvas) return;
    
    const parent = waveCanvas.parentElement;
    const displayW = Math.max(120, Math.floor(waveCanvas.clientWidth || (parent ? parent.clientWidth : 280)));
    const displayH = Math.max(60, Math.floor(waveCanvas.clientHeight || (parent ? parent.clientHeight : 110)));
    if (displayW <= 0 || displayH <= 0) return;

    const targetW = Math.round(displayW * dpr);
    const targetH = Math.round(displayH * dpr);
    if (waveCanvas.width !== targetW || waveCanvas.height !== targetH) {
      waveCanvas.width = targetW;
      waveCanvas.height = targetH;
    }

    waveCtx.save();
    waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    waveCtx.clearRect(0, 0, displayW, displayH);

    const centerY = displayH / 2;
    const amplitude = displayH * 0.35;

    // Reticle Grid
    waveCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    waveCtx.lineWidth = 1;
    for (let x = 0; x <= displayW; x += 28) {
      waveCtx.beginPath();
      waveCtx.moveTo(x, 0);
      waveCtx.lineTo(x, displayH);
      waveCtx.stroke();
    }

    // 0V Solid Centerline
    waveCtx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    waveCtx.beginPath();
    waveCtx.moveTo(0, centerY);
    waveCtx.lineTo(displayW, centerY);
    waveCtx.stroke();

    const freqVal = (typeof currentFreq === "number" && !isNaN(currentFreq)) ? currentFreq : 60.0;
    const freqRatio = freqVal / (sim.nominalFreq || 60.0);
    waveformPhase += (0.16 * freqRatio);

    let strokeColor = "#10B981"; // Green normal
    if (freqVal < 59.80) strokeColor = "#EF4444"; // Red alert
    else if (freqVal < 59.95 || freqVal > 60.05) strokeColor = "#F59E0B"; // Amber

    const wavelength = 56 / Math.max(0.1, freqRatio);
    const k = (2 * Math.PI) / wavelength;

    waveCtx.shadowColor = strokeColor;
    waveCtx.shadowBlur = 6;
    waveCtx.lineWidth = 2.2;
    waveCtx.strokeStyle = strokeColor;
    waveCtx.beginPath();

    for (let x = 0; x <= displayW; x += 1.5) {
      const y = centerY + amplitude * Math.sin(k * x - waveformPhase);
      if (x === 0) waveCtx.moveTo(x, y);
      else waveCtx.lineTo(x, y);
    }
    waveCtx.stroke();
    waveCtx.restore();

    const scopeReadout = document.getElementById("scope-freq-display");
    if (scopeReadout) {
      scopeReadout.textContent = freqVal.toFixed(3) + " Hz";
      scopeReadout.style.color = strokeColor;
    }
  }

  // --- 2. FREQUENCY TRAJECTORY CHART RENDERER ---
  function drawFreqHistoryChart() {
    if (!freqCtx || !freqCanvas) return;
    
    const parent = freqCanvas.parentElement;
    const displayW = Math.max(120, Math.floor(freqCanvas.clientWidth || (parent ? parent.clientWidth : 280)));
    const displayH = Math.max(60, Math.floor(freqCanvas.clientHeight || (parent ? parent.clientHeight : 110)));
    if (displayW <= 0 || displayH <= 0) return;

    const targetW = Math.round(displayW * dpr);
    const targetH = Math.round(displayH * dpr);
    if (freqCanvas.width !== targetW || freqCanvas.height !== targetH) {
      freqCanvas.width = targetW;
      freqCanvas.height = targetH;
    }

    freqCtx.save();
    freqCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    freqCtx.clearRect(0, 0, displayW, displayH);

    const history = sim.history;
    const count = history && history.freq ? history.freq.length : 0;
    const nominal = sim.nominalFreq || 60.0;
    const minF = nominal - 1.2;
    const maxF = nominal + 0.3;

    const leftPad = 28;
    const getY = (f) => displayH - ((f - minF) / (maxF - minF)) * (displayH - 14) - 7;
    const getX = (idx) => (idx / Math.max(1, count - 1)) * (displayW - (leftPad + 6)) + leftPad;

    // Normal Band Zone (59.90 to 60.10 Hz)
    const yUpperNorm = getY(nominal + 0.1);
    const yLowerNorm = getY(nominal - 0.1);
    freqCtx.fillStyle = "rgba(16, 185, 129, 0.12)";
    freqCtx.fillRect(leftPad, yUpperNorm, displayW - leftPad, yLowerNorm - yUpperNorm);

    // UFLS Line (59.10 Hz)
    const yUFLS = getY(59.1);
    freqCtx.strokeStyle = "rgba(239, 68, 68, 0.7)";
    freqCtx.lineWidth = 1;
    freqCtx.setLineDash([3, 2]);
    freqCtx.beginPath();
    freqCtx.moveTo(leftPad, yUFLS);
    freqCtx.lineTo(displayW, yUFLS);
    freqCtx.stroke();
    freqCtx.setLineDash([]);

    // Y Axis Ticks
    freqCtx.fillStyle = "#94A3B8";
    freqCtx.font = "8.5px ui-monospace, monospace";
    freqCtx.textAlign = "right";
    for (let f = minF; f <= maxF + 0.001; f += 0.5) {
      const y = getY(f);
      freqCtx.fillText(f.toFixed(1), leftPad - 3, y + 2.5);
    }

    if (count >= 1) {
      const currentF = history.freq[count - 1];
      let strokeCol = "#10B981";
      if (currentF < 59.8) strokeCol = "#EF4444";
      else if (currentF < 59.95) strokeCol = "#F59E0B";

      freqCtx.shadowColor = strokeCol;
      freqCtx.shadowBlur = 4;
      freqCtx.strokeStyle = strokeCol;
      freqCtx.lineWidth = 1.8;
      freqCtx.beginPath();
      let lastX = leftPad, lastY = getY(history.freq[0]);
      for (let i = 0; i < count; i++) {
        const x = getX(i);
        const y = getY(history.freq[i]);
        if (i === 0) freqCtx.moveTo(x, y);
        else freqCtx.lineTo(x, y);
        lastX = x;
        lastY = y;
      }
      freqCtx.stroke();

      freqCtx.fillStyle = "#FFFFFF";
      freqCtx.beginPath();
      freqCtx.arc(lastX, lastY, 2.5, 0, 2 * Math.PI);
      freqCtx.fill();
    }

    freqCtx.restore();
  }

  // --- 3. DYNAMIC CAPACITY BLOCKS, COSTS & DISPATCH REASONS ---
  function updateCapacityBlocksAndCosts(state) {
    const dtHours = (sim.dt * 300) / 3600;
    const region = REGIONAL_GRIDS[currentRegionKey] || REGIONAL_GRIDS.luzon;

    const midMeritMaxMW = region.plants.midmerit ? region.plants.midmerit.capacityMW : 600;
    let midMeritActiveMW = midMeritMaxMW * 0.75;
    if (sim.trippedPlantMW > 0) {
      midMeritActiveMW = Math.min(midMeritMaxMW, midMeritActiveMW + sim.trippedPlantMW * 0.4);
    }

    const peakerMaxMW = region.plants.peaking ? region.plants.peaking.capacityMW : 300;
    let peakerActiveMW = sim.nonSpinActive ? state.nonSpinDeployed : (sim.trippedPlantMW > 350 ? Math.min(peakerMaxMW, (sim.trippedPlantMW - 350) * 0.7) : 0);

    const baseFleetMaxMW = Math.max(100, region.baseDemandMW - Math.round(midMeritMaxMW * 0.75));
    const currentBaseGen = Math.max(0, baseFleetMaxMW - sim.trippedPlantMW);

    // Update Mini Reserve Meters & Animated Stages in Tab 1
    // 1. BESS FFR & Draining Battery
    if (typeof sim.bessSoC === "undefined") sim.bessSoC = 94.0;
    const ffrCap = sim.ffrCapacity || 150;
    if (state.ffrDeployed > 0.5) {
      // Drain battery proportional to injection
      sim.bessSoC = Math.max(12.0, sim.bessSoC - (state.ffrDeployed / ffrCap) * 0.08);
    } else if (sim.bessSoC < 96.0) {
      // Slow float recharge
      sim.bessSoC = Math.min(96.0, sim.bessSoC + 0.02);
    }

    const meterFfr = document.getElementById("meter-ffr");
    const statFfrVal = document.getElementById("stat-ffr-val");
    const statFfrMax = document.getElementById("stat-ffr-max");
    const badgeFfr = document.getElementById("badge-ffr");
    const bessFill = document.getElementById("bess-level-fill");
    const bessSocText = document.getElementById("bess-soc-text");
    const inverterPulse = document.getElementById("inverter-pulse");

    if (meterFfr) meterFfr.style.width = ffrCap > 0 ? ((state.ffrDeployed / ffrCap) * 100).toFixed(0) + "%" : "0%";
    if (statFfrVal) statFfrVal.textContent = Math.round(state.ffrDeployed) + " MW";
    if (statFfrMax) statFfrMax.textContent = ffrCap + " MW Cap";
    if (badgeFfr) badgeFfr.textContent = state.ffrDeployed > 10 ? "INJECTING" : "STANDBY";

    if (bessFill) {
      bessFill.style.width = sim.bessSoC.toFixed(1) + "%";
      if (sim.bessSoC < 25) {
        bessFill.style.background = "linear-gradient(90deg, #EF4444, #F87171)";
      } else if (sim.bessSoC < 50) {
        bessFill.style.background = "linear-gradient(90deg, #F59E0B, #FBBF24)";
      } else {
        bessFill.style.background = "linear-gradient(90deg, #6366F1, #818CF8)";
      }
    }
    if (bessSocText) bessSocText.textContent = `${sim.bessSoC.toFixed(1)}% SoC`;
    if (inverterPulse) {
      if (state.ffrDeployed > 10) {
        inverterPulse.textContent = `⚡ Pumping +${Math.round(state.ffrDeployed)}M`;
        inverterPulse.style.color = "#818CF8";
      } else {
        inverterPulse.textContent = "Inverter Ready";
        inverterPulse.style.color = "#94A3B8";
      }
    }

    // 2. AGC Regulation & Spinning Hydro Runner
    const regCap = sim.regCapacity || 200;
    const meterReg = document.getElementById("meter-reg");
    const statRegVal = document.getElementById("stat-reg-val");
    const statRegMax = document.getElementById("stat-reg-max");
    const badgeReg = document.getElementById("badge-reg");
    const runnerReg = document.getElementById("runner-reg");
    const wicketGateText = document.getElementById("wicket-gate-text");

    if (meterReg) meterReg.style.width = regCap > 0 ? (Math.max(0, state.regDeployed / regCap) * 100).toFixed(0) + "%" : "0%";
    if (statRegVal) statRegVal.textContent = Math.round(state.regDeployed) + " MW";
    if (statRegMax) statRegMax.textContent = regCap + " MW Cap";
    if (badgeReg) badgeReg.textContent = Math.abs(state.regDeployed) > 10 ? "RAMPING" : "ACTIVE";

    const isRegFast = Math.abs(state.regDeployed) > 8;
    if (runnerReg) {
      runnerReg.setAttribute("class", isRegFast ? "mini-runner-svg spinning-fast" : "mini-runner-svg spinning-slow");
    }
    if (wicketGateText) {
      const gatePct = Math.min(100, Math.max(20, Math.round(30 + (Math.abs(state.regDeployed) / regCap) * 70)));
      wicketGateText.textContent = `Gate: ${gatePct}%`;
    }

    // 3. Spinning Droop & Steam Turbine Rotor
    const spinCap = sim.spinCapacity || 400;
    const meterSpin = document.getElementById("meter-spin");
    const statSpinVal = document.getElementById("stat-spin-val");
    const statSpinMax = document.getElementById("stat-spin-max");
    const badgeSpin = document.getElementById("badge-spin");
    const rotorSpin = document.getElementById("rotor-spin");
    const droopValveText = document.getElementById("droop-valve-text");

    if (meterSpin) meterSpin.style.width = spinCap > 0 ? ((state.spinDeployed / spinCap) * 100).toFixed(0) + "%" : "0%";
    if (statSpinVal) statSpinVal.textContent = Math.round(state.spinDeployed) + " MW";
    if (statSpinMax) statSpinMax.textContent = spinCap + " MW Cap";
    if (badgeSpin) badgeSpin.textContent = state.spinDeployed > 15 ? "DROOP ACTIVE" : "4% DROOP";

    const isSpinFast = state.spinDeployed > 15;
    if (rotorSpin) {
      rotorSpin.setAttribute("class", isSpinFast ? "mini-rotor-svg spinning-turbo" : "mini-rotor-svg spinning-idle");
    }
    if (droopValveText) {
      const valvePct = Math.min(100, Math.max(10, Math.round(15 + (state.spinDeployed / spinCap) * 85)));
      droopValveText.textContent = `Valve: ${valvePct}%`;
    }

    // 4. Fast Non-Spin Peakers & Reciprocating Pistons with Sparks
    const nonSpinCap = sim.nonSpinCapacity || 300;
    const meterNonSpin = document.getElementById("meter-nonspin");
    const statNonSpinVal = document.getElementById("stat-nonspin-val");
    const statNonSpinMax = document.getElementById("stat-nonspin-max");
    const badgeNonSpin = document.getElementById("badge-nonspin");
    const piston1 = document.getElementById("piston-1");
    const piston2 = document.getElementById("piston-2");
    const spark1 = document.getElementById("spark-1");
    const spark2 = document.getElementById("spark-2");
    const peakerRpmText = document.getElementById("peaker-rpm-text");

    if (meterNonSpin) meterNonSpin.style.width = nonSpinCap > 0 ? ((state.nonSpinDeployed / nonSpinCap) * 100).toFixed(0) + "%" : "0%";
    if (statNonSpinVal) statNonSpinVal.textContent = Math.round(state.nonSpinDeployed) + " MW";
    if (statNonSpinMax) statNonSpinMax.textContent = nonSpinCap + " MW Cap";
    if (badgeNonSpin) badgeNonSpin.textContent = state.nonSpinDeployed > 10 ? "DISPATCHED" : "AUTO STANDBY";

    const isPeakerRunning = (state.nonSpinDeployed > 6) || sim.nonSpinActive;
    if (piston1 && piston2 && spark1 && spark2 && peakerRpmText) {
      if (isPeakerRunning) {
        piston1.className = "mini-piston piston-active-1";
        piston2.className = "mini-piston piston-active-2";
        spark1.className = "mini-spark spark-flash-1";
        spark2.className = "mini-spark spark-flash-2";
        peakerRpmText.textContent = "750 RPM (RUN)";
        peakerRpmText.style.color = "#F59E0B";
      } else {
        piston1.className = "mini-piston";
        piston2.className = "mini-piston";
        spark1.className = "mini-spark";
        spark2.className = "mini-spark";
        peakerRpmText.textContent = "0 RPM (STBY)";
        peakerRpmText.style.color = "#94A3B8";
      }
    }

    // Auto Peaker Dispatch Status Button
    const peakerAutoDot = document.getElementById("peaker-auto-dot");
    const peakerAutoBtnLabel = document.getElementById("peaker-auto-btn-label");
    if (peakerAutoBtnLabel && peakerAutoDot) {
      if (sim.nonSpinAutoMode) {
        peakerAutoBtnLabel.textContent = state.nonSpinDeployed > 5 ? `Peakers: +${Math.round(state.nonSpinDeployed)}M` : "Peakers: AUTO";
        peakerAutoDot.className = "dot-indicator dot-green";
      } else {
        peakerAutoBtnLabel.textContent = `Peakers: MANUAL (${sim.nonSpinActive ? 'RUN' : 'OFF'})`;
        peakerAutoDot.className = "dot-indicator dot-amber";
      }
    }

    // Tab 2: Update Capacity Card Stats
    const statBase = document.getElementById("stat-baseload-val");
    const statMid = document.getElementById("stat-midmerit-val");
    const statPeak = document.getElementById("stat-peaking-val");
    if (statBase) statBase.textContent = `${Math.round(currentBaseGen)} MW`;
    if (statMid) statMid.textContent = `${Math.round(midMeritActiveMW)} MW`;
    if (statPeak) statPeak.textContent = `${Math.round(peakerActiveMW)} MW`;

    // --- Tab 1: UPDATE VERTICAL GENERATION & RESERVES STACK BAR GRAPH ---
    const vbarValBase = document.getElementById("vbar-val-baseload");
    const vbarFillBase = document.getElementById("vbar-fill-baseload");
    if (vbarValBase) vbarValBase.textContent = `${Math.round(currentBaseGen)}M`;
    if (vbarFillBase) vbarFillBase.style.height = `${Math.min(100, Math.max(0, (currentBaseGen / baseFleetMaxMW) * 100)).toFixed(0)}%`;

    const vbarValMid = document.getElementById("vbar-val-midmerit");
    const vbarFillMid = document.getElementById("vbar-fill-midmerit");
    if (vbarValMid) vbarValMid.textContent = `${Math.round(midMeritActiveMW)}M`;
    if (vbarFillMid) vbarFillMid.style.height = `${Math.min(100, Math.max(0, (midMeritActiveMW / midMeritMaxMW) * 100)).toFixed(0)}%`;

    const vbarValPeak = document.getElementById("vbar-val-peaking");
    const vbarFillPeak = document.getElementById("vbar-fill-peaking");
    if (vbarValPeak) vbarValPeak.textContent = `${Math.round(peakerActiveMW)}M`;
    if (vbarFillPeak) vbarFillPeak.style.height = `${Math.min(100, Math.max(0, (peakerActiveMW / peakerMaxMW) * 100)).toFixed(0)}%`;

    const vbarValFfr = document.getElementById("vbar-val-ffr");
    const vbarFillFfr = document.getElementById("vbar-fill-ffr");
    if (vbarValFfr) vbarValFfr.textContent = `${Math.round(state.ffrDeployed)}M`;
    if (vbarFillFfr) vbarFillFfr.style.height = `${Math.min(100, Math.max(0, (state.ffrDeployed / ffrCap) * 100)).toFixed(0)}%`;

    const vbarValReg = document.getElementById("vbar-val-reg");
    const vbarFillReg = document.getElementById("vbar-fill-reg");
    if (vbarValReg) vbarValReg.textContent = `${Math.round(Math.abs(state.regDeployed))}M`;
    if (vbarFillReg) vbarFillReg.style.height = `${Math.min(100, Math.max(0, (Math.abs(state.regDeployed) / regCap) * 100)).toFixed(0)}%`;

    const vbarValSpin = document.getElementById("vbar-val-spin");
    const vbarFillSpin = document.getElementById("vbar-fill-spin");
    if (vbarValSpin) vbarValSpin.textContent = `${Math.round(state.spinDeployed)}M`;
    if (vbarFillSpin) vbarFillSpin.style.height = `${Math.min(100, Math.max(0, (state.spinDeployed / spinCap) * 100)).toFixed(0)}%`;

    const vbarValNonSpin = document.getElementById("vbar-val-nonspin");
    const vbarFillNonSpin = document.getElementById("vbar-fill-nonspin");
    if (vbarValNonSpin) vbarValNonSpin.textContent = `${Math.round(state.nonSpinDeployed)}M`;
    if (vbarFillNonSpin) vbarFillNonSpin.style.height = `${Math.min(100, Math.max(0, (state.nonSpinDeployed / nonSpinCap) * 100)).toFixed(0)}%`;

    const totalActiveGenStack = currentBaseGen + midMeritActiveMW + peakerActiveMW + state.ffrDeployed + Math.abs(state.regDeployed) + state.spinDeployed + state.nonSpinDeployed;
    const stackBadge = document.getElementById("stack-total-mw-badge");
    if (stackBadge) stackBadge.textContent = `${Math.round(totalActiveGenStack).toLocaleString()} MW Total`;

    // Financial calculations
    const baseloadRatePerHour = currentBaseGen * 4850.00;
    const midMeritRatePerHour = midMeritActiveMW * 1000.00;
    const peakerRatePerHour = peakerActiveMW * 1180.55;
    const ffrTotalRatePerHour = (sim.ffrCapacity * 1875.00) + (state.ffrDeployed * 5500.00);
    const regTotalRatePerHour = (sim.regCapacity * 1361.11) + (Math.abs(state.regDeployed) * 3500.00);
    const spinTotalRatePerHour = (sim.spinCapacity * 826.39) + (state.spinDeployed * 4500.00);
    const nonSpinTotalRatePerHour = (sim.nonSpinCapacity * 861.11) + (state.nonSpinDeployed * 7200.00);

    const grandTotalHourlyRate = baseloadRatePerHour + midMeritRatePerHour + peakerRatePerHour + ffrTotalRatePerHour + regTotalRatePerHour + spinTotalRatePerHour + nonSpinTotalRatePerHour;

    // Live Payout in Ribbon
    const costRibbon = document.getElementById("metric-reserves-cost");
    if (costRibbon) costRibbon.textContent = `₱${(grandTotalHourlyRate / 1000000).toFixed(2)}M/hr`;

    // ERC Penalty
    let currentPenaltyRatePerHour = 0;
    if (sim.trippedPlantMW > 0) {
      currentPenaltyRatePerHour = 125000;
      sessionFinancials.ercPenaltyAccrued += currentPenaltyRatePerHour * dtHours;
    }
    const ercRibbon = document.getElementById("metric-erc-penalty-rate");
    if (ercRibbon) {
      ercRibbon.textContent = currentPenaltyRatePerHour > 0 ? `₱${Math.round(currentPenaltyRatePerHour/1000)}k/hr` : `₱0/hr`;
      ercRibbon.style.color = currentPenaltyRatePerHour > 0 ? "#EF4444" : "#64748B";
    }

    // Live Dispatch Reason Banner
    const reasonBanner = document.getElementById("dispatch-reason-banner");
    const reasonTitle = document.getElementById("dispatch-reason-title");
    const reasonText = document.getElementById("dispatch-reason-text");

    if (reasonBanner && reasonTitle && reasonText) {
      if (sim.trippedPlantMW > 0) {
        reasonBanner.className = "dispatch-reason-banner alert-state";
        reasonTitle.textContent = `🚨 FORCED OUTAGE IN ${region.name.toUpperCase()} (-${sim.trippedPlantMW} MW)`;
        reasonText.textContent = `BESS FFR injected in <200ms to arrest RoCoF. Spinning reserves & AGC Regulation ramped to restore 60.00 Hz nominal.`;
      } else if (sim.nonSpinActive && state.nonSpinDeployed > 10) {
        reasonBanner.className = "dispatch-reason-banner alert-state";
        reasonTitle.textContent = `🚀 PEAKERS DISPATCHED (+${Math.round(state.nonSpinDeployed)} MW)`;
        reasonText.textContent = `Fast-start peakers running to support peak load demands.`;
      } else {
        reasonBanner.className = "dispatch-reason-banner";
        reasonTitle.textContent = `System Status: Steady-State Baseline Operation`;
        reasonText.textContent = `Baseload fleet meets demand. Reserves synchronized on standby readiness under WESM rules.`;
      }
    }
  }

  // --- 4. RESIDENTIAL BILL IMPACT CALCULATOR (TAB 3) ---
  function updateBillImpactCalculator(state) {
    const kwh = selectedMonthlyKWh;
    const BASE_TOTAL_RATE = 11.6000;
    const BASE_GEN = 6.5500;
    const BASE_AS = 0.1420;
    const BASE_DIST = 3.6500;
    const BASE_TAX = 1.2580;
    const BASE_MONTHLY_BILL = kwh * BASE_TOTAL_RATE;

    const baseASHourly = (sim.ffrCapacity * 1875.00) + (sim.regCapacity * 1361.11) + (sim.spinCapacity * 826.39) + (sim.nonSpinCapacity * 861.11);
    const activeASHourly = baseASHourly + (state.ffrDeployed * 5500.00) + (Math.abs(state.regDeployed) * 3500.00) + (state.spinDeployed * 4500.00) + (state.nonSpinDeployed * 7200.00);
    const deltaASHourly = Math.max(0, activeASHourly - baseASHourly);

    const hourlyGridEnergyMWh = Math.max(100, sim.totalLoad);
    const deltaASRate = (deltaASHourly / (hourlyGridEnergyMWh * 1000)) * 1.035;
    const currentASRate = BASE_AS + deltaASRate;

    let wesmSpotPriceMWh = 4850.00;
    if (sim.trippedPlantMW > 0) {
      const outageSeverity = Math.min(1.0, sim.trippedPlantMW / 1200);
      wesmSpotPriceMWh = 4850.00 + outageSeverity * 9500.00;
    }
    if (state.nonSpinDeployed > 10) {
      wesmSpotPriceMWh += (state.nonSpinDeployed / sim.nonSpinCapacity) * 6500.00;
    }
    const deltaWesmSpotKWh = Math.max(0, (wesmSpotPriceMWh - 4850.00) / 1000.00);
    const deltaGenRate = deltaWesmSpotKWh * 0.15;
    const currentGenRate = BASE_GEN + deltaGenRate;

    const deltaTaxRate = (deltaGenRate + deltaASRate) * 0.12;
    const currentTaxRate = BASE_TAX + deltaTaxRate;

    const currentTotalRate = currentGenRate + currentASRate + BASE_DIST + currentTaxRate;
    const currentMonthlyBill = kwh * currentTotalRate;
    const deltaMonthlyBill = currentMonthlyBill - BASE_MONTHLY_BILL;
    const deltaTotalRate = currentTotalRate - BASE_TOTAL_RATE;
    const deltaPct = BASE_MONTHLY_BILL > 0 ? (deltaMonthlyBill / BASE_MONTHLY_BILL) * 100 : 0;

    const kwhDisplay = document.getElementById("bill-kwh-display");
    const billIncreaseTotal = document.getElementById("bill-increase-total");
    const billIncreasePct = document.getElementById("bill-increase-pct");
    const billTotalAmount = document.getElementById("bill-total-amount");
    const billBaseAmount = document.getElementById("bill-base-amount");
    const billEffectiveRate = document.getElementById("bill-effective-rate");
    const billRateDiff = document.getElementById("bill-rate-diff");
    const billAsRate = document.getElementById("bill-as-rate");
    const billAsMonthly = document.getElementById("bill-as-monthly");

    if (kwhDisplay) kwhDisplay.textContent = `${kwh} kWh`;
    if (billIncreaseTotal) {
      billIncreaseTotal.textContent = `+₱${deltaMonthlyBill.toFixed(2)} / mo`;
      billIncreaseTotal.style.color = deltaMonthlyBill > 1 ? "#E11D48" : "#10B981";
    }
    if (billIncreasePct) {
      billIncreasePct.textContent = `+${deltaPct.toFixed(1)}% vs Baseline`;
      billIncreasePct.style.color = deltaMonthlyBill > 1 ? "#9F1239" : "#047857";
    }
    if (billTotalAmount) billTotalAmount.textContent = `₱${currentMonthlyBill.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    if (billBaseAmount) billBaseAmount.textContent = `Base: ₱${BASE_MONTHLY_BILL.toFixed(2)} (@ ₱11.60/kWh)`;
    if (billEffectiveRate) billEffectiveRate.textContent = `₱${currentTotalRate.toFixed(4)} / kWh`;
    if (billRateDiff) {
      billRateDiff.textContent = deltaTotalRate > 0.0001 ? `+₱${deltaTotalRate.toFixed(4)}/kWh surge` : `Normal tariff benchmark`;
      billRateDiff.style.color = deltaTotalRate > 0.0001 ? "#BE123C" : "#0284C7";
    }
    if (billAsRate) billAsRate.textContent = `₱${currentASRate.toFixed(4)} / kWh`;
    if (billAsMonthly) billAsMonthly.textContent = `₱${(kwh * currentASRate).toFixed(2)}/mo for ${kwh} kWh`;

    // Table elements
    const tableGen = document.getElementById("table-gen-rate");
    const tableGenMonthly = document.getElementById("table-gen-monthly");
    const tableAs = document.getElementById("table-as-rate");
    const tableAsMonthly = document.getElementById("table-as-monthly");
    const tableTax = document.getElementById("table-tax-rate");
    const tableTaxMonthly = document.getElementById("table-tax-monthly");
    const tableTotal = document.getElementById("table-total-rate");
    const tableTotalMonthly = document.getElementById("table-total-monthly");

    if (tableGen) tableGen.textContent = `₱${currentGenRate.toFixed(4)}/kWh`;
    if (tableGenMonthly) tableGenMonthly.textContent = `₱${(kwh * currentGenRate).toFixed(2)}`;
    if (tableAs) tableAs.textContent = `₱${currentASRate.toFixed(4)}/kWh`;
    if (tableAsMonthly) tableAsMonthly.textContent = `₱${(kwh * currentASRate).toFixed(2)}`;
    if (tableTax) tableTax.textContent = `₱${currentTaxRate.toFixed(4)}/kWh`;
    if (tableTaxMonthly) tableTaxMonthly.textContent = `₱${(kwh * currentTaxRate).toFixed(2)}`;
    if (tableTotal) tableTotal.textContent = `₱${currentTotalRate.toFixed(4)}/kWh`;
    if (tableTotalMonthly) tableTotalMonthly.textContent = `₱${currentMonthlyBill.toFixed(2)}`;
  }

  // Bill Tier Buttons
  document.querySelectorAll(".btn-bill-tier").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-bill-tier").forEach(b => b.classList.remove("active-tier"));
      btn.classList.add("active-tier");
      selectedMonthlyKWh = parseInt(btn.getAttribute("data-kwh") || "200", 10);
      playBeep(520, "sine", 0.08);
    });
  });

  // --- 5. LEGAL BASIS MODAL DOSSIER ---
  const modal = document.getElementById("plantDossierModal");
  const modalClose = document.getElementById("modal-close-btn");
  const modalOk = document.getElementById("modal-ok-btn");
  const modalPlantName = document.getElementById("modal-plant-name");
  const modalBody = document.getElementById("modal-body-content");

  function openPlantModal(plantOrKey) {
    const region = REGIONAL_GRIDS[currentRegionKey] || REGIONAL_GRIDS.luzon;
    let plant = null;
    let legalRole = "baseload";

    if (region.plants[plantOrKey]) {
      plant = region.plants[plantOrKey];
      legalRole = plantOrKey;
    } else {
      const allRegionalPlants = [
        ...(REGIONAL_POWER_PLANTS.luzon || []),
        ...(REGIONAL_POWER_PLANTS.visayas || []),
        ...(REGIONAL_POWER_PLANTS.mindanao || [])
      ];
      const found = allRegionalPlants.find(p => p.id === plantOrKey || p.name === plantOrKey);
      if (found) {
        plant = {
          name: found.name,
          owner: found.owner,
          location: found.location,
          region: found.location.includes("Visayas") ? "Visayas" : (found.location.includes("Mindanao") ? "Mindanao" : "Luzon"),
          type: found.fuel,
          capacityMW: found.mw,
          ercCaseNumber: found.ercCaseNumber || "ERC Case No. 2024-023 RC",
          ercApprovalType: found.ercApprovalType || "ERC Approved PSA",
          ercRate: found.ercRate || found.defaultRate || "₱625.00 / kW-mo",
          wesmRole: found.aspaCategory || found.category,
          ercOutageCapDays: found.ercOutageCapDays || 16.8,
          ercShowCauseOrder: found.ercShowCauseOrder || "ERC Compliance Audit Res 10-2020",
          ercPenaltyBase: found.ercPenaltyBase || "Section 46 Administrative Base",
          unexcusedPenaltyPerHour: found.unexcusedPenaltyPerHour || 100000,
          statutoryNotes: found.statutoryNotes || ""
        };
        const cat = (found.category || found.fuel || "").toLowerCase();
        if (cat.includes("ccgt") || cat.includes("gas")) legalRole = "midmerit";
        else if (cat.includes("peaker") || cat.includes("diesel")) legalRole = "peaking";
        else if (cat.includes("bess") || cat.includes("fast freq")) legalRole = "ffr";
        else if (cat.includes("hydro") || cat.includes("reg")) legalRole = "reg";
        else if (cat.includes("spin")) legalRole = "spin";
        else legalRole = "baseload";
      } else {
        plant = region.plants.baseload;
        legalRole = "baseload";
      }
    }

    const legal = (typeof LEGAL_BASIS_REGISTRY !== "undefined" && LEGAL_BASIS_REGISTRY[legalRole]) 
      ? LEGAL_BASIS_REGISTRY[legalRole] 
      : (typeof LEGAL_BASIS_REGISTRY !== "undefined" ? LEGAL_BASIS_REGISTRY.baseload : null);

    if (modalPlantName) modalPlantName.textContent = `${plant.name}`;
    if (modalBody) {
      modalBody.innerHTML = `
        <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px;">
          <span class="badge badge-wesm">${plant.region} Balancing Area</span>
          <span class="badge badge-green">${plant.capacityMW} MW Capacity</span>
          <span class="badge badge-erc">${plant.ercCaseNumber}</span>
        </div>

        <div class="modal-erc-card">
          <div class="modal-row">
            <span class="modal-label">ERC Approved Rate:</span>
            <span class="modal-val" style="color: #059669;">${plant.ercRate}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Contracted Role:</span>
            <span class="modal-val" style="color: #EA580C;">${plant.wesmRole}</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Annual Outage Cap:</span>
            <span class="modal-val">${plant.ercOutageCapDays || 16.8} Days/Yr (Res 10-2020)</span>
          </div>
          <div class="modal-row">
            <span class="modal-label">Unexcused Outage Fine:</span>
            <span class="modal-val" style="color: #DC2626;">₱${(plant.unexcusedPenaltyPerHour || 100000).toLocaleString()}/hr</span>
          </div>
        </div>

        <div style="font-size: 11px; font-weight: 800; margin-top: 8px; margin-bottom: 4px;">⚖️ Statutory Legal Bases:</div>
        
        <div class="legal-card">
          <div><span class="legal-tag aspa-tag">ASPA RULES</span><span class="legal-citation">${legal ? legal.aspa.citation : "DOE DC2021-10-0031"}</span></div>
          <div class="legal-card-title">${legal ? legal.aspa.title : "ASPA Procurement Rules"}</div>
          <div class="legal-card-body">${legal ? legal.aspa.summary : "Mandates 100% firm contracting of ancillary reserves via CSP."}</div>
        </div>

        <div class="legal-card">
          <div><span class="legal-tag pgc-tag">PGC RULES</span><span class="legal-citation">${legal ? legal.pgc.citation : "PGC 2016 Edition"}</span></div>
          <div class="legal-card-title">${legal ? legal.pgc.title : "Philippine Grid Code"}</div>
          <div class="legal-card-body">${legal ? legal.pgc.summary : "Mandates dynamic governor droop and N-1 contingency headroom."}</div>
        </div>

        <div class="legal-card">
          <div><span class="legal-tag oats-tag">OATS & EPIRA</span><span class="legal-citation">${legal ? legal.oats.citation : "OATS Module C / RA 9136"}</span></div>
          <div class="legal-card-title">${legal ? legal.oats.title : "Open Access Transmission"}</div>
          <div class="legal-card-body">${legal ? legal.oats.summary : "Governs ancillary service pass-through tariffs to consumers."}</div>
        </div>
      `;
    }

    if (modal) {
      modal.classList.add("active");
      modal.style.display = "flex";
    }
    playBeep(650, "sine", 0.08);
  }

  if (typeof window !== "undefined") window.openPlantModal = openPlantModal;

  function closeModal() {
    if (modal) {
      modal.classList.remove("active");
      modal.style.display = "none";
    }
  }

  modalClose?.addEventListener("click", closeModal);
  modalOk?.addEventListener("click", closeModal);
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // Attach direct trip/restore listeners on the 7 capacity cards in Tab 2
  document.querySelectorAll(".btn-trip-card-unit").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const unitKey = btn.getAttribute("data-unit");
      if (!unitKey) return;
      const plant = getRegionalPlantForUnit(unitKey);
      if (!plant) return;

      const currentlyTripped = sim.activeOutages.some(p => p.id === plant.id);
      if (currentlyTripped) {
        sim.untripPlant(plant.id);
        logTerminal("PLANT-RESTORE", `✓ <strong>${plant.name}</strong> restored (+${plant.mw} MW).`, "term-tag-info");
        playBeep(520, "sine", 0.12);
      } else {
        sim.tripPlant(plant);
        logTerminal("PLANT-TRIP", `💥 <strong>${plant.name}</strong> FORCED OUTAGE (-${plant.mw} MW)! Total Lost: -${sim.trippedPlantMW} MW.`, "term-tag-alert");
        playBeep(180, "sawtooth", 0.45);
      }
      renderRegionalOutageButtons(currentRegionKey);
      updateTrippedBadge();
    });
  });

  // --- 6. EMERGENCY CONTROLS & AUTO PEAKER DISPATCH ---
  // Random Power Plant Contingency Trip Button
  function triggerRandomPlantTrip() {
    const plantList = (typeof REGIONAL_POWER_PLANTS !== "undefined" && REGIONAL_POWER_PLANTS[currentRegionKey]) 
      ? REGIONAL_POWER_PLANTS[currentRegionKey] 
      : [];
    
    if (!plantList || plantList.length === 0) return;

    const availableToTrip = plantList.filter(p => !sim.activeOutages.some(outage => outage.id === p.id));

    let chosenPlant;
    if (availableToTrip.length > 0) {
      chosenPlant = availableToTrip[Math.floor(Math.random() * availableToTrip.length)];
      sim.tripPlant(chosenPlant);
      logTerminal("RANDOM-TRIP", `💥 <strong>${chosenPlant.name}</strong> FORCED CONTINGENCY (-${chosenPlant.mw} MW lost)! Trajectory reacting.`, "term-tag-alert");
      logTerminal("ERC-AUDIT", `⚖️ Grid disturbance logged under <strong>${chosenPlant.ercCaseNumber || "ERC Res 10-2020"}</strong>. Penalty rate: ₱${(chosenPlant.unexcusedPenaltyPerHour || 125000).toLocaleString()}/hr.`, "term-tag-erc");
      playBeep(180, "sawtooth", 0.45);
    } else {
      sim.clearContingency();
      chosenPlant = plantList[Math.floor(Math.random() * plantList.length)];
      sim.tripPlant(chosenPlant);
      logTerminal("RANDOM-TRIP", `🔄 Grid reset & fresh random trip on <strong>${chosenPlant.name}</strong> (-${chosenPlant.mw} MW lost)!`, "term-tag-alert");
      playBeep(180, "sawtooth", 0.45);
    }

    renderRegionalOutageButtons(currentRegionKey);
    updateTrippedBadge();
    updateCardTripButtonsUI();
  }

  document.getElementById("btn-random-trip")?.addEventListener("click", triggerRandomPlantTrip);

  document.getElementById("btn-start-peakers")?.addEventListener("click", () => {
    if (sim.nonSpinAutoMode) {
      if (sim.trippedPlantMW > 0 || sim.nonSpinActive) {
        logTerminal("PEAKER-AUTO", `⚡ Peakers: AUTO DISPATCH ACTIVE (+${Math.round(sim.nonSpinDeployed)} MW).`, "term-tag-dispatch");
        playBeep(640, "sine", 0.12);
      } else {
        sim.nonSpinAutoMode = false;
        sim.nonSpinActive = true;
        logTerminal("PEAKER-MANUAL", `⚙️ Peakers: MANUAL OVERRIDE (+${sim.nonSpinCapacity} MW dispatched).`, "term-tag-dispatch");
        playBeep(600, "sine", 0.15);
      }
    } else {
      sim.nonSpinAutoMode = true;
      logTerminal("PEAKER-AUTO", `⚡ Peakers: AUTO DISPATCH ENABLED (NGCP SCADA).`, "term-tag-info");
      playBeep(520, "sine", 0.12);
    }
  });

  document.getElementById("btn-clear-disturb")?.addEventListener("click", () => {
    sim.clearContingency();
    renderRegionalOutageButtons(currentRegionKey);
    logTerminal("SO-CLEAR", `✓ All plant outages cleared. Grid restored to nominal capacity.`, "term-tag-info");
    playBeep(520, "sine", 0.1);
  });

  document.getElementById("btn-manual-mld-10")?.addEventListener("click", () => {
    sim.triggerManualMLD(0.10);
    playBeep(140, "sawtooth", 0.5);
  });

  document.getElementById("btn-manual-mld-20")?.addEventListener("click", () => {
    sim.triggerManualMLD(0.20);
    playBeep(120, "sawtooth", 0.6);
  });

  document.getElementById("btn-restore-mld")?.addEventListener("click", () => {
    sim.restoreMLD();
    playBeep(580, "sine", 0.12);
  });

  // Audio Toggle
  const btnAudio = document.getElementById("btn-audio-toggle");
  btnAudio?.addEventListener("click", () => {
    audioEnabled = !audioEnabled;
    btnAudio.textContent = audioEnabled ? "🔊" : "🔇";
    if (audioEnabled) playBeep(600, "sine", 0.08);
  });

  // Global Simulation Reset
  function executeSimulationReset() {
    sim.resetDefaults();
    sessionFinancials.totalPaid = 0;
    sessionFinancials.baseloadPaid = 0;
    sessionFinancials.ffrPaid = 0;
    sessionFinancials.regPaid = 0;
    sessionFinancials.spinPaid = 0;
    sessionFinancials.nonSpinPaid = 0;
    sessionFinancials.ercPenaltyAccrued = 0;
    sessionFinancials.currentPenaltyRatePerHour = 0;
    setRegionalGrid(currentRegionKey);
    logTerminal("RESET", `✓ Entire grid simulation reset to 60.00 Hz steady-state for ${currentRegionKey.toUpperCase()}.`, "term-tag-info");
    playBeep(440, "sine", 0.1);
  }

  document.querySelectorAll("#btn-reset-all, .btn-reset-sim").forEach(btn => {
    btn.addEventListener("click", executeSimulationReset);
  });

  // --- 7. MAIN SIMULATION 60 FPS LOOP ---
  let lastTime = performance.now();

  function loop(currentTime) {
    try {
      const elapsedSec = Math.min(0.1, (currentTime - lastTime) / 1000.0);
      lastTime = currentTime;

      // Advance Physics ODE Step
      sim.step(elapsedSec);

      const state = {
        freq: sim.freq,
        rocof: sim.deltaFreq / Math.max(0.01, sim.dt),
        totalGen: sim.totalGen,
        totalLoad: sim.totalLoad,
        ffrDeployed: sim.ffrDeployed,
        regDeployed: sim.regDeployed,
        spinDeployed: sim.spinDeployed,
        nonSpinDeployed: sim.nonSpinDeployed,
        trippedPlantMW: sim.trippedPlantMW
      };

      // 1. Update Telemetry Readouts
      const metricFreq = document.getElementById("metric-freq");
      const metricFreqDev = document.getElementById("metric-freq-dev");
      const metricRocof = document.getElementById("metric-rocof");
      const metricBalance = document.getElementById("metric-balance");
      const statusBadge = document.getElementById("grid-status-badge");

      if (metricFreq) {
        metricFreq.textContent = sim.freq.toFixed(3) + " Hz";
        if (sim.freq < 59.80) metricFreq.style.color = "#EF4444";
        else if (sim.freq < 59.95 || sim.freq > 60.05) metricFreq.style.color = "#F59E0B";
        else metricFreq.style.color = "#10B981";
      }

      if (metricFreqDev) {
        const dev = sim.freq - (sim.nominalFreq || 60.0);
        metricFreqDev.textContent = `${dev >= 0 ? '+' : ''}${dev.toFixed(3)} Hz from 60 Hz Nominal`;
      }

      if (metricRocof) {
        metricRocof.textContent = `${state.rocof >= 0 ? '+' : ''}${state.rocof.toFixed(2)} Hz/s`;
        metricRocof.style.color = Math.abs(state.rocof) > 0.3 ? "#EF4444" : "#F8FAFC";
      }

      if (metricBalance) {
        const net = Math.round(sim.totalGen - sim.totalLoad);
        metricBalance.textContent = `${net >= 0 ? '+' : ''}${net} MW`;
        metricBalance.style.color = net < -50 ? "#EF4444" : "#10B981";
      }

      if (statusBadge) {
        if (sim.freq < 59.10) {
          statusBadge.className = "badge badge-red";
          statusBadge.textContent = "🚨 UFLS ACTIVE";
        } else if (sim.freq < 59.80) {
          statusBadge.className = "badge badge-red";
          statusBadge.textContent = "⚡ RED ALERT";
        } else if (sim.freq < 59.95) {
          statusBadge.className = "badge badge-amber";
          statusBadge.textContent = "⚠️ YELLOW ALERT";
        } else {
          statusBadge.className = "badge badge-green";
          statusBadge.textContent = "● BALANCED";
        }
      }

      if (terminalClock) {
        terminalClock.textContent = `T+${sim.time.toFixed(1)}s`;
      }

      // 2. Render Scope Instruments (AC Waveform & Frequency Trajectory)
      drawWaveform(sim.freq);
      drawFreqHistoryChart();

      // 3. Update Capacity Blocks, Costs & Reasons
      updateCapacityBlocksAndCosts(state);

      // 4. Update Bill Calculator
      updateBillImpactCalculator(state);
    } catch (err) {
      console.error("Simulation Loop Error:", err);
    }

    requestAnimationFrame(loop);
  }

  // Initial Load
  setRegionalGrid("luzon");
  requestAnimationFrame(loop);
});
