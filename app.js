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
  let smoothedFreqMin = 59.85;
  let smoothedFreqMax = 60.15;

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

  // --- EXPANDED REAL-TIME SCADA EMS & WESM DISPATCH TERMINAL CONTROLLER ---
  const terminalBody = document.getElementById("terminal-body");
  const terminalClock = document.getElementById("terminal-clock");
  const terminalFilterLabel = document.getElementById("terminal-filter-label");
  const terminalLineCounter = document.getElementById("terminal-line-counter");
  const terminalStatusMsg = document.getElementById("terminal-status-msg");
  const terminalAutoscrollBadge = document.getElementById("terminal-autoscroll-badge");
  const terminalLiveDot = document.getElementById("terminal-live-dot");
  const terminalSearchInput = document.getElementById("terminal-search-input");

  const termKpiAgc = document.getElementById("term-kpi-agc");
  const termKpiAce = document.getElementById("term-kpi-ace");
  const termKpiLmp = document.getElementById("term-kpi-lmp");
  const termKpiRocof = document.getElementById("term-kpi-rocof");

  let terminalLogsBuffer = [];
  let terminalActiveFilter = "all";
  let terminalSearchQuery = "";
  let terminalIsPaused = false;
  let terminalAutoScroll = true;
  const TERMINAL_MAX_BUFFER = 400;

  // Category mapping helper
  function getCategoryForTag(tag) {
    const t = (tag || "").toUpperCase();
    if (t.includes("TRIP") || t.includes("ALERT") || t.includes("ALARM") || t.includes("COLLAPSE") || t.includes("ROCOF")) return "alert";
    if (t.includes("WESM") || t.includes("LMP") || t.includes("MARKET") || t.includes("PEAKER")) return "wesm";
    if (t.includes("BESS") || t.includes("FFR") || t.includes("INVERTER") || t.includes("BATTERY")) return "bess";
    if (t.includes("ALD") || t.includes("UFLS") || t.includes("FEEDER") || t.includes("MLD")) return "ald";
    if (t.includes("ERC") || t.includes("DOCKET") || t.includes("LEGAL") || t.includes("STATUTE")) return "erc";
    return "scada";
  }

  function logTerminal(tag, message, tagClass = "term-tag-info", isAlert = false) {
    const timeStr = `T+${sim.time.toFixed(1)}s`;
    const category = getCategoryForTag(tag);
    const rawText = `[${timeStr}] [${tag}] ${message.replace(/<[^>]*>?/gm, "")}`;

    const logEntry = {
      id: "log_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      timeStr: timeStr,
      tag: tag,
      message: message,
      tagClass: tagClass,
      category: category,
      rawText: rawText,
      isAlert: isAlert || tagClass.includes("alert"),
      simTime: sim.time
    };

    terminalLogsBuffer.push(logEntry);
    if (terminalLogsBuffer.length > TERMINAL_MAX_BUFFER) {
      terminalLogsBuffer.shift();
    }

    updateTerminalCounts();

    if (!terminalIsPaused) {
      renderSingleTerminalLine(logEntry);
    }
  }

  function renderSingleTerminalLine(entry) {
    if (!terminalBody) return;

    // Check filter match
    if (terminalActiveFilter !== "all" && entry.category !== terminalActiveFilter) {
      return;
    }

    // Check search query match
    if (terminalSearchQuery && !entry.rawText.toLowerCase().includes(terminalSearchQuery)) {
      return;
    }

    const line = document.createElement("div");
    line.className = `term-line ${entry.isAlert ? "term-line-highlight" : ""}`;
    line.innerHTML = `
      <span class="term-time">${entry.timeStr}</span>
      <span class="term-tag ${entry.tagClass}">${entry.tag}</span>
      <span class="term-msg">${entry.message}</span>
    `;

    terminalBody.appendChild(line);

    // Limit DOM children for performance
    while (terminalBody.children.length > 250) {
      terminalBody.removeChild(terminalBody.children[0]);
    }

    if (terminalAutoScroll) {
      terminalBody.scrollTop = terminalBody.scrollHeight;
    }
  }

  function refreshTerminalDisplay() {
    if (!terminalBody) return;
    terminalBody.innerHTML = "";

    const filtered = terminalLogsBuffer.filter(entry => {
      if (terminalActiveFilter !== "all" && entry.category !== terminalActiveFilter) return false;
      if (terminalSearchQuery && !entry.rawText.toLowerCase().includes(terminalSearchQuery)) return false;
      return true;
    });

    // Render up to last 200 matches
    const startIdx = Math.max(0, filtered.length - 200);
    for (let i = startIdx; i < filtered.length; i++) {
      const entry = filtered[i];
      const line = document.createElement("div");
      line.className = `term-line ${entry.isAlert ? "term-line-highlight" : ""}`;
      line.innerHTML = `
        <span class="term-time">${entry.timeStr}</span>
        <span class="term-tag ${entry.tagClass}">${entry.tag}</span>
        <span class="term-msg">${entry.message}</span>
      `;
      terminalBody.appendChild(line);
    }

    if (terminalAutoScroll) {
      terminalBody.scrollTop = terminalBody.scrollHeight;
    }

    if (terminalLineCounter) {
      terminalLineCounter.textContent = `${filtered.length} of ${terminalLogsBuffer.length} events`;
    }
  }

  function updateTerminalCounts() {
    const countAll = document.getElementById("count-log-all");
    if (countAll) countAll.textContent = terminalLogsBuffer.length;

    if (terminalLineCounter) {
      terminalLineCounter.textContent = `${terminalLogsBuffer.length} events`;
    }
  }

  // Wire Terminal Filter Chips
  document.querySelectorAll(".btn-term-filter").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-term-filter").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      terminalActiveFilter = btn.getAttribute("data-filter") || "all";

      if (terminalFilterLabel) {
        terminalFilterLabel.textContent = `FILTER: ${terminalActiveFilter.toUpperCase()}`;
        terminalFilterLabel.className = terminalActiveFilter === "alert" ? "badge badge-red" : (terminalActiveFilter === "all" ? "badge badge-blue" : "badge badge-indigo");
      }

      refreshTerminalDisplay();
      playBeep(520, "sine", 0.05);
    });
  });

  // Wire Terminal Search
  terminalSearchInput?.addEventListener("input", (e) => {
    terminalSearchQuery = (e.target.value || "").toLowerCase().trim();
    refreshTerminalDisplay();
  });

  document.getElementById("btn-term-search-clear")?.addEventListener("click", () => {
    if (terminalSearchInput) {
      terminalSearchInput.value = "";
      terminalSearchQuery = "";
      refreshTerminalDisplay();
      playBeep(480, "sine", 0.05);
    }
  });

  // Wire Clear Terminal Button
  document.getElementById("btn-clear-terminal")?.addEventListener("click", () => {
    terminalLogsBuffer = [];
    if (terminalBody) terminalBody.innerHTML = "";
    updateTerminalCounts();
    logTerminal("SYSTEM", "Terminal telemetry log cleared by System Operator.", "term-tag-info");
    playBeep(440, "sine", 0.08);
  });

  // Wire Pause / Resume Feed Toggle
  const btnPauseTerm = document.getElementById("btn-pause-terminal");
  const termPauseIcon = document.getElementById("term-pause-icon");
  const termPauseLabel = document.getElementById("term-pause-label");

  btnPauseTerm?.addEventListener("click", () => {
    terminalIsPaused = !terminalIsPaused;
    if (terminalIsPaused) {
      if (termPauseIcon) termPauseIcon.textContent = "▶";
      if (termPauseLabel) termPauseLabel.textContent = "Resume";
      btnPauseTerm.classList.add("btn-danger-soft");
      if (terminalLiveDot) terminalLiveDot.className = "dot-indicator dot-amber";
      if (terminalStatusMsg) terminalStatusMsg.textContent = "⏸ Telemetry Feed Paused (Logging to background buffer)";
    } else {
      if (termPauseIcon) termPauseIcon.textContent = "⏸";
      if (termPauseLabel) termPauseLabel.textContent = "Pause";
      btnPauseTerm.classList.remove("btn-danger-soft");
      if (terminalLiveDot) terminalLiveDot.className = "dot-indicator dot-green";
      if (terminalStatusMsg) terminalStatusMsg.textContent = "● Telemetry Stream Active (200ms cyclic rate)";
      refreshTerminalDisplay();
    }
    playBeep(540, "sine", 0.06);
  });

  // Wire Auto-scroll Toggle Badge
  terminalAutoscrollBadge?.addEventListener("click", () => {
    terminalAutoScroll = !terminalAutoScroll;
    if (terminalAutoScroll) {
      terminalAutoscrollBadge.textContent = "AUTOSCROLL: ON";
      terminalAutoscrollBadge.className = "badge badge-green";
      if (terminalBody) terminalBody.scrollTop = terminalBody.scrollHeight;
    } else {
      terminalAutoscrollBadge.textContent = "AUTOSCROLL: OFF";
      terminalAutoscrollBadge.className = "badge badge-amber";
    }
    playBeep(500, "sine", 0.05);
  });

  // Wire Copy Logs to Clipboard
  document.getElementById("btn-copy-terminal")?.addEventListener("click", () => {
    if (terminalLogsBuffer.length === 0) return;
    const textData = terminalLogsBuffer.map(e => e.rawText).join("\n");
    if (navigator.clipboard) {
      navigator.clipboard.writeText(textData).then(() => {
        logTerminal("OPERATOR", "📋 Entire SCADA & WESM log buffer copied to clipboard.", "term-tag-info");
        playBeep(650, "sine", 0.1);
      });
    }
  });

  // Wire Export CSV / Log File
  document.getElementById("btn-export-terminal")?.addEventListener("click", () => {
    if (terminalLogsBuffer.length === 0) return;
    let csvContent = "Timestamp,SimulationTime,Category,Tag,Message\n";
    terminalLogsBuffer.forEach(e => {
      const cleanMsg = e.message.replace(/<[^>]*>?/gm, "").replace(/"/g, '""');
      csvContent += `"${e.timeStr}","${e.simTime.toFixed(2)}s","${e.category}","${e.tag}","${cleanMsg}"\n`;
    });
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `NGCP_SCADA_WESM_Telemetry_${currentRegionKey.toUpperCase()}_T${sim.time.toFixed(0)}s.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    logTerminal("EXPORT", `💾 SCADA EMS log archive exported (${terminalLogsBuffer.length} records).`, "term-tag-info");
    playBeep(700, "sine", 0.12);
  });

  // Seed Initial High-Fidelity Terminal Logs
  logTerminal("SCADA-EMS", "NGCP National Control Center (NCC) SCADA/AGC Online. 4-second closed loop synchronized.", "term-tag-scada");
  logTerminal("WESM-RTM", "Ex-Ante Co-Optimization Engine active across Luzon, Visayas & Mindanao. Baseline LMP: <strong>₱4,850.00/MWh</strong>.", "term-tag-wesm");
  logTerminal("GRID-STATUS", "One Grid Philippines nominal: <strong>60.000 Hz</strong>. N-1 Benchmark: <strong>Dinginin 668 MW</strong>. Dynamic reserves armed.", "term-tag-dispatch");
  logTerminal("ASPA-AUDIT", "Firm ASPA contracts verified under <strong>DOE DC2021-10-0031 & ERC Res. 01-2024</strong>. Standby availability: 100%.", "term-tag-erc");

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
          <span class="plant-btn-name">${plant.name} (-${plant.mw}M)</span>
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
          logTerminal("PLANT-RESTORE", `✓ <strong>${plant.name}</strong> [52A-CLOSE]: Resynchronized (+${plant.mw} MW). Remaining grid deficit: <strong>-${sim.trippedPlantMW} MW</strong>.`, "term-tag-restore");
          playBeep(520, "sine", 0.12);
        } else {
          sim.tripPlant(plant);
          btn.className = "plant-btn plant-btn-tripped";
          if (ctaSpan) {
            ctaSpan.className = "plant-restore-cta";
            ctaSpan.textContent = "🔄 RESTORE";
          }
          logTerminal("PLANT-TRIP", `💥 <strong>${plant.name}</strong> [BREAKER 52A TRIP]: FORCED OUTAGE (-${plant.mw} MW lost at ${plant.location})! Total Lost: <strong>-${sim.trippedPlantMW} MW</strong>.`, "term-tag-alert");
          logTerminal("ERC-AUDIT", `⚖️ <strong>${plant.ercCaseNumber || "ERC Res 10-2020"}</strong>: Unscheduled trip breach. Penalty rate: <strong class="term-penalty">₱${(plant.unexcusedPenaltyPerHour || 125000).toLocaleString()}/hr</strong> under EPIRA Section 46.`, "term-tag-erc");
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
    renderFleetDirectory();
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
    smoothedFreqMin = 59.85;
    smoothedFreqMax = 60.15;

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

    // Update Specific Plant Names & Million Profit Values in Active Reserves Reaction Boxes
    const ffrM = (sim.ffrCapacity * 1350000 / 1000000).toFixed(1);
    const regM = (sim.regCapacity * 980000 / 1000000).toFixed(1);
    const spinM = (sim.spinCapacity * 595000 / 1000000).toFixed(1);
    const nonSpinM = (sim.nonSpinCapacity * 680000 / 1000000).toFixed(1);

    const cleanPlantName = (n) => n ? n.replace(/\s*\([\d,]+\s*MW\)/gi, '').trim() : '';

    if (p.ffr && document.getElementById("res-plant-name-ffr")) document.getElementById("res-plant-name-ffr").textContent = `${cleanPlantName(p.ffr.name)} (${p.ffr.capacityMW} MW)`;
    if (p.reg && document.getElementById("res-plant-name-reg")) document.getElementById("res-plant-name-reg").textContent = `${cleanPlantName(p.reg.name)} (${p.reg.capacityMW} MW)`;
    if (p.spin && document.getElementById("res-plant-name-spin")) document.getElementById("res-plant-name-spin").textContent = `${cleanPlantName(p.spin.name)} (${p.spin.capacityMW} MW)`;
    if (p.nonspin && document.getElementById("res-plant-name-nonspin")) document.getElementById("res-plant-name-nonspin").textContent = `${cleanPlantName(p.nonspin.name)} (${p.nonspin.capacityMW} MW)`;

    if (document.getElementById("profit-val-ffr")) document.getElementById("profit-val-ffr").textContent = `₱${ffrM}M/mo`;
    if (document.getElementById("profit-val-reg")) document.getElementById("profit-val-reg").textContent = `₱${regM}M/mo`;
    if (document.getElementById("profit-val-spin")) document.getElementById("profit-val-spin").textContent = `₱${spinM}M/mo`;
    if (document.getElementById("profit-val-nonspin")) document.getElementById("profit-val-nonspin").textContent = `₱${nonSpinM}M/mo`;

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
      } else if (targetTabId === "tab-fleet") {
        renderFleetDirectory();
      }
      playBeep(540, "sine", 0.06);
    });
  });

  // --- EXTENSIVE FLEET DIRECTORY CONTROLLER (TAB 2) ---
  let fleetActiveRegionFilter = "all";
  let fleetActiveTechFilter = "all";
  let fleetSearchQuery = "";

  function getAllPhilippineFleetUnits() {
    const list = [];

    // Luzon
    if (typeof REGIONAL_POWER_PLANTS !== "undefined" && REGIONAL_POWER_PLANTS.luzon) {
      REGIONAL_POWER_PLANTS.luzon.forEach(p => list.push({ ...p, regionKey: "luzon", regionName: "Luzon" }));
    }
    // Visayas
    if (typeof REGIONAL_POWER_PLANTS !== "undefined" && REGIONAL_POWER_PLANTS.visayas) {
      REGIONAL_POWER_PLANTS.visayas.forEach(p => list.push({ ...p, regionKey: "visayas", regionName: "Visayas" }));
    }
    // Mindanao
    if (typeof REGIONAL_POWER_PLANTS !== "undefined" && REGIONAL_POWER_PLANTS.mindanao) {
      REGIONAL_POWER_PLANTS.mindanao.forEach(p => list.push({ ...p, regionKey: "mindanao", regionName: "Mindanao" }));
    }
    // HVDC Interconnections
    if (typeof HVDC_SYSTEMS !== "undefined") {
      if (HVDC_SYSTEMS.mvip) {
        list.push({
          id: HVDC_SYSTEMS.mvip.id,
          name: "⚡ " + HVDC_SYSTEMS.mvip.name,
          mw: HVDC_SYSTEMS.mvip.capacityMW,
          category: "HVDC Subsea Link",
          fuel: "±350 kV DC Submarine Transmission",
          owner: "NGCP (National Grid Corp of the Philippines)",
          location: "Mindanao ⇄ Visayas (Bohol Sea Subsea Cable)",
          defaultRate: "₱0.0485/kWh",
          ercCaseNumber: HVDC_SYSTEMS.mvip.ercCaseNumber,
          ercApprovalType: HVDC_SYSTEMS.mvip.ercApprovalType,
          ercRate: HVDC_SYSTEMS.mvip.ercRate,
          ercOutageCapDays: HVDC_SYSTEMS.mvip.ercOutageCapDays,
          ercShowCauseOrder: HVDC_SYSTEMS.mvip.ercShowCauseOrder,
          ercPenaltyBase: HVDC_SYSTEMS.mvip.ercPenaltyBase,
          unexcusedPenaltyPerHour: HVDC_SYSTEMS.mvip.unexcusedPenaltyPerHour,
          aspaCategory: HVDC_SYSTEMS.mvip.aspaCategory,
          statutoryNotes: HVDC_SYSTEMS.mvip.summary,
          regionKey: "hvdc",
          regionName: "HVDC Link"
        });
      }
      if (HVDC_SYSTEMS.leyte_luzon) {
        list.push({
          id: HVDC_SYSTEMS.leyte_luzon.id,
          name: "⚡ " + HVDC_SYSTEMS.leyte_luzon.name,
          mw: HVDC_SYSTEMS.leyte_luzon.capacityMW,
          category: "HVDC Subsea Link",
          fuel: "±350 kV DC Subsea Transmission",
          owner: "NGCP (National Grid Corp of the Philippines)",
          location: "Leyte ⇄ Luzon (San Bernardino Strait)",
          defaultRate: "₱0.0392/kWh",
          ercCaseNumber: HVDC_SYSTEMS.leyte_luzon.ercCaseNumber,
          ercApprovalType: HVDC_SYSTEMS.leyte_luzon.ercApprovalType,
          ercRate: HVDC_SYSTEMS.leyte_luzon.ercRate,
          ercOutageCapDays: HVDC_SYSTEMS.leyte_luzon.ercOutageCapDays,
          ercShowCauseOrder: HVDC_SYSTEMS.leyte_luzon.ercShowCauseOrder,
          ercPenaltyBase: HVDC_SYSTEMS.leyte_luzon.ercPenaltyBase,
          unexcusedPenaltyPerHour: HVDC_SYSTEMS.leyte_luzon.unexcusedPenaltyPerHour,
          aspaCategory: HVDC_SYSTEMS.leyte_luzon.aspaCategory,
          statutoryNotes: HVDC_SYSTEMS.leyte_luzon.summary,
          regionKey: "hvdc",
          regionName: "HVDC Link"
        });
      }
    }

    return list;
  }

  function renderFleetDirectory() {
    const grid = document.getElementById("fleet-directory-grid");
    if (!grid) return;

    const allUnits = getAllPhilippineFleetUnits();
    const query = (fleetSearchQuery || "").toLowerCase().trim();

    const filtered = allUnits.filter(u => {
      // 1. Region filter
      if (fleetActiveRegionFilter !== "all") {
        if (fleetActiveRegionFilter === "hvdc") {
          if (u.regionKey !== "hvdc") return false;
        } else if (u.regionKey !== fleetActiveRegionFilter) {
          return false;
        }
      }

      // 2. Tech / Category filter
      if (fleetActiveTechFilter !== "all") {
        const cat = (u.category || "").toLowerCase();
        const fuel = (u.fuel || "").toLowerCase();
        const name = (u.name || "").toLowerCase();

        if (fleetActiveTechFilter === "coal") {
          if (!fuel.includes("coal") && !cat.includes("coal") && !cat.includes("supercritical")) return false;
        } else if (fleetActiveTechFilter === "gas") {
          if (!fuel.includes("gas") && !fuel.includes("lng") && !cat.includes("ccgt") && !cat.includes("gas")) return false;
        } else if (fleetActiveTechFilter === "hydro") {
          if (!fuel.includes("hydro") && !cat.includes("hydro")) return false;
        } else if (fleetActiveTechFilter === "geo") {
          if (!fuel.includes("geo") && !cat.includes("geo")) return false;
        } else if (fleetActiveTechFilter === "bess") {
          if (!fuel.includes("bess") && !fuel.includes("battery") && !cat.includes("ffr") && !name.includes("bess")) return false;
        } else if (fleetActiveTechFilter === "peaker") {
          if (!fuel.includes("diesel") && !cat.includes("peaking") && !cat.includes("peaker") && !name.includes("peaker") && !fuel.includes("bunker") && !name.includes("barge")) return false;
        }
      }

      // 3. Search query filter
      if (query.length > 0) {
        const matchStr = `${u.name} ${u.owner} ${u.location} ${u.fuel} ${u.category} ${u.ercCaseNumber} ${u.aspaCategory || ""}`.toLowerCase();
        if (!matchStr.includes(query)) return false;
      }

      return true;
    });

    // Update Fleet count badge
    const countBadge = document.getElementById("fleet-count-badge");
    if (countBadge) {
      countBadge.textContent = `${filtered.length} of ${allUnits.length} Units`;
    }

    grid.innerHTML = "";

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 24px 12px; text-align: center; color: #64748B; background: #F8FAFC; border-radius: 6px; border: 1px dashed #CBD5E1;">
          <div style="font-size: 20px; margin-bottom: 4px;">🔍</div>
          <div style="font-size: 11.5px; font-weight: 700; color: #334155;">No matching power plants found</div>
          <div style="font-size: 9.5px; color: #94A3B8; margin-top: 2px;">Try clearing filters or searching for different terms like "Dinginin", "Magat", "BESS", or "ERC".</div>
        </div>
      `;
      return;
    }

    filtered.forEach(unit => {
      const isTripped = sim.activeOutages.some(p => p.id === unit.id);
      const card = document.createElement("div");
      card.className = `fleet-unit-card ${isTripped ? "is-tripped" : ""}`;
      
      let regClass = "badge-reg-luzon";
      if (unit.regionKey === "visayas") regClass = "badge-reg-visayas";
      if (unit.regionKey === "mindanao") regClass = "badge-reg-mindanao";
      if (unit.regionKey === "hvdc") regClass = "badge-reg-hvdc";

      const shortDocket = unit.ercCaseNumber ? unit.ercCaseNumber.replace("ERC Case No. ", "ERC ") : "ERC Docket";
      const capDays = unit.ercOutageCapDays ? `${unit.ercOutageCapDays}d Outage Cap/yr` : "ERC Regulated";

      card.innerHTML = `
        <div class="fleet-unit-top">
          <div class="fleet-unit-title">${unit.name}</div>
          <div class="fleet-unit-badges">
            <span class="badge-unit-cap">${unit.mw} MW</span>
            <span class="badge-unit-region ${regClass}">${unit.regionName}</span>
          </div>
        </div>

        <div class="fleet-unit-meta">
          <div><strong>Owner:</strong> ${unit.owner || "Independent Power Producer"}</div>
          <div><strong>Location:</strong> ${unit.location}</div>
          <div><strong>Technology:</strong> ${unit.fuel || unit.category}</div>
        </div>

        <div class="fleet-unit-role">
          ${unit.aspaCategory || unit.category || "WESM Scheduled Facility"}
        </div>

        <div class="fleet-unit-erc">
          <span>⚖️ ${shortDocket}</span>
          <span>${capDays}</span>
        </div>

        <div class="fleet-unit-actions">
          <button class="btn-fleet-trip ${isTripped ? 'btn-restore' : 'btn-danger'}">
            ${isTripped ? '🔄 RESTORE TO GRID' : '⚡ CLICK TO TRIP'}
          </button>
          <button class="btn-fleet-dossier" onclick="event.stopPropagation(); window.openPlantModal('${unit.id}');">
            ⚖️ View Dossier
          </button>
        </div>
      `;

      // Wire Trip / Restore button
      const tripBtn = card.querySelector(".btn-fleet-trip");
      if (tripBtn) {
        tripBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const currentlyTripped = sim.activeOutages.some(p => p.id === unit.id);
          if (currentlyTripped) {
            sim.untripPlant(unit.id);
            logTerminal("PLANT-RESTORE", `✓ <strong>${unit.name}</strong> [52A-CLOSE]: Resynchronized (+${unit.mw} MW). Remaining grid deficit: <strong>-${sim.trippedPlantMW} MW</strong>.`, "term-tag-restore");
            playBeep(520, "sine", 0.12);
          } else {
            sim.tripPlant(unit);
            logTerminal("PLANT-TRIP", `💥 <strong>${unit.name}</strong> [BREAKER 52A TRIP]: FORCED CONTINGENCY (-${unit.mw} MW lost at ${unit.location})! Total Lost: <strong>-${sim.trippedPlantMW} MW</strong>.`, "term-tag-alert");
            logTerminal("ERC-AUDIT", `⚖️ <strong>${unit.ercCaseNumber || "ERC Res 10-2020"}</strong>: Unscheduled forced trip logged. Statutory penalty fine: <strong class="term-penalty">₱${(unit.unexcusedPenaltyPerHour || 125000).toLocaleString()}/hr</strong>.`, "term-tag-erc");
            playBeep(180, "sawtooth", 0.45);
          }
          updateTrippedBadge();
          renderRegionalOutageButtons(currentRegionKey);
          renderFleetDirectory();
        });
      }

      grid.appendChild(card);
    });
  }

  // Wire Fleet Directory Region Filter Chips
  document.querySelectorAll(".btn-fleet-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-fleet-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      fleetActiveRegionFilter = btn.getAttribute("data-fleet-region") || "all";
      renderFleetDirectory();
      playBeep(520, "sine", 0.06);
    });
  });

  // Wire Fleet Directory Tech / Category Filter Chips
  document.querySelectorAll(".btn-tech-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-tech-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      fleetActiveTechFilter = btn.getAttribute("data-tech") || "all";
      renderFleetDirectory();
      playBeep(500, "sine", 0.06);
    });
  });

  // Wire Fleet Search Input & Clear
  const fleetSearchInput = document.getElementById("fleet-search-input");
  fleetSearchInput?.addEventListener("input", (e) => {
    fleetSearchQuery = e.target.value;
    renderFleetDirectory();
  });

  document.getElementById("btn-fleet-search-clear")?.addEventListener("click", () => {
    if (fleetSearchInput) {
      fleetSearchInput.value = "";
      fleetSearchQuery = "";
      renderFleetDirectory();
      playBeep(480, "sine", 0.06);
    }
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

  // --- 2. ADAPTIVE FREQUENCY TRAJECTORY CHART RENDERER ---
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

    // 1. Dynamic Window & Range Analysis
    let minData = (typeof sim.freq === "number" && !isNaN(sim.freq)) ? sim.freq : nominal;
    let maxData = minData;

    if (count > 0) {
      // Analyze recent trajectory window (last 160 points / ~8s)
      const windowSize = Math.min(count, 160);
      const startIdx = count - windowSize;
      for (let i = startIdx; i < count; i++) {
        const val = history.freq[i];
        if (typeof val === "number" && !isNaN(val)) {
          if (val < minData) minData = val;
          if (val > maxData) maxData = val;
        }
      }
    }

    // Adaptive zoom: minimum span of 0.16 Hz around current frequency to magnify subtle waveforms & ripples
    const rawSpan = maxData - minData;
    const targetSpan = Math.max(0.16, rawSpan * 1.32);
    const center = (minData + maxData) / 2;

    const targetMin = center - (targetSpan / 2);
    const targetMax = center + (targetSpan / 2);

    // Fast-expand on sudden drops/trips, smooth glide during recovery
    const lerpSpeed = (targetMin < smoothedFreqMin || targetMax > smoothedFreqMax) ? 0.22 : 0.08;
    smoothedFreqMin += (targetMin - smoothedFreqMin) * lerpSpeed;
    smoothedFreqMax += (targetMax - smoothedFreqMax) * lerpSpeed;

    // Constrain within physical bounds
    const minF = Math.max(50.0, smoothedFreqMin);
    const maxF = Math.min(65.0, Math.max(minF + 0.10, smoothedFreqMax));
    const range = maxF - minF;

    // 2. Adaptive Step Sizing and Decimal Formatting
    let step = 0.50;
    let precision = 1;

    if (range <= 0.22) {
      step = 0.05;
      precision = 2;
    } else if (range <= 0.50) {
      step = 0.10;
      precision = 2;
    } else if (range <= 1.20) {
      step = 0.20;
      precision = 1;
    } else if (range <= 2.40) {
      step = 0.50;
      precision = 1;
    } else {
      step = 1.00;
      precision = 1;
    }

    const leftPad = precision === 2 ? 34 : 28;
    const topPad = 6;
    const botPad = 6;
    const usableH = displayH - (topPad + botPad);
    const usableW = displayW - (leftPad + 6);

    const getY = (f) => displayH - botPad - ((f - minF) / (maxF - minF)) * usableH;
    const getX = (idx) => (idx / Math.max(1, count - 1)) * usableW + leftPad;

    // 3. Highlight PGC Normal Operating Band (59.90 to 60.10 Hz)
    const normTop = nominal + 0.10;
    const normBot = nominal - 0.10;
    const visibleNormTop = Math.min(maxF, normTop);
    const visibleNormBot = Math.max(minF, normBot);

    if (visibleNormTop > visibleNormBot) {
      const yTop = getY(visibleNormTop);
      const yBot = getY(visibleNormBot);
      freqCtx.fillStyle = "rgba(16, 185, 129, 0.09)";
      freqCtx.fillRect(leftPad, yTop, displayW - leftPad, Math.max(1, yBot - yTop));
    }

    // 4. Highlight Under-Frequency Load Shedding (UFLS) Threshold
    const uflsVal = nominal === 60.0 ? 59.10 : 49.10;
    if (uflsVal >= minF && uflsVal <= maxF) {
      const yUFLS = getY(uflsVal);
      freqCtx.strokeStyle = "rgba(239, 68, 68, 0.70)";
      freqCtx.lineWidth = 1;
      freqCtx.setLineDash([3, 2]);
      freqCtx.beginPath();
      freqCtx.moveTo(leftPad, yUFLS);
      freqCtx.lineTo(displayW, yUFLS);
      freqCtx.stroke();
      freqCtx.setLineDash([]);

      freqCtx.fillStyle = "rgba(239, 68, 68, 0.85)";
      freqCtx.font = "7.5px ui-monospace, monospace";
      freqCtx.textAlign = "right";
      freqCtx.fillText(`UFLS ${uflsVal.toFixed(1)}`, displayW - 4, yUFLS - 2);
    }

    // 5. Adaptive Dynamic Y-Axis Ticks & Gridlines
    const startTick = Math.ceil((minF + 0.0001) / step) * step;
    freqCtx.font = "7.5px ui-monospace, monospace";
    freqCtx.textAlign = "right";

    let lastDrawnY = -999;
    for (let f = startTick; f <= maxF - 0.0001; f += step) {
      const y = getY(f);
      if (y >= topPad + 2 && y <= displayH - botPad - 2) {
        const isNominal = Math.abs(f - nominal) < 0.0001;

        // Subtle horizontal guide line
        freqCtx.strokeStyle = isNominal ? "rgba(16, 185, 129, 0.30)" : "rgba(255, 255, 255, 0.06)";
        freqCtx.lineWidth = isNominal ? 1.0 : 0.6;
        freqCtx.beginPath();
        freqCtx.moveTo(leftPad, y);
        freqCtx.lineTo(displayW, y);
        freqCtx.stroke();

        // Prevent superimposing tick text if too close to previous label
        if (Math.abs(y - lastDrawnY) >= 10.5 || isNominal) {
          freqCtx.fillStyle = isNominal ? "#10B981" : "#94A3B8";
          freqCtx.fillText(f.toFixed(precision), leftPad - 3, y + 2.5);
          lastDrawnY = y;
        }
      }
    }

    // 6. Real-Time Frequency Trajectory Curve
    if (count >= 1) {
      const currentF = history.freq[count - 1];
      let strokeCol = "#10B981"; // Green normal
      if (currentF < (nominal - 0.20)) strokeCol = "#EF4444"; // Red alert
      else if (currentF < (nominal - 0.05) || currentF > (nominal + 0.05)) strokeCol = "#F59E0B"; // Amber

      freqCtx.shadowColor = strokeCol;
      freqCtx.shadowBlur = 4;
      freqCtx.strokeStyle = strokeCol;
      freqCtx.lineWidth = 1.8;
      freqCtx.beginPath();

      let lastX = leftPad, lastY = getY(history.freq[0]);
      for (let i = 0; i < count; i++) {
        const x = getX(i);
        const y = Math.max(topPad - 2, Math.min(displayH - botPad + 2, getY(history.freq[i])));
        if (i === 0) freqCtx.moveTo(x, y);
        else freqCtx.lineTo(x, y);
        lastX = x;
        lastY = y;
      }
      freqCtx.stroke();

      // Glowing Trajectory Head Dot
      freqCtx.shadowBlur = 6;
      freqCtx.shadowColor = "#FFFFFF";
      freqCtx.fillStyle = "#FFFFFF";
      freqCtx.beginPath();
      freqCtx.arc(lastX, lastY, 2.5, 0, 2 * Math.PI);
      freqCtx.fill();
    }

    // 7. Update Header Badge with Dynamic Scale Readout
    const chartBadge = document.getElementById("freq-chart-badge");
    if (chartBadge) {
      chartBadge.textContent = `Span: ±${((maxF - minF) / 2).toFixed(2)}Hz`;
    }

    freqCtx.restore();
  }

  // --- 3. DYNAMIC CAPACITY BLOCKS, COSTS & DISPATCH REASONS ---
  function updateCapacityBlocksAndCosts(state) {
    const dtHours = (sim.dt * 300) / 3600;
    const region = REGIONAL_GRIDS[currentRegionKey] || REGIONAL_GRIDS.luzon;

    // Accurate Tripped MW Categorization per Grid Sector
    let trippedMidMW = 0;
    let trippedPeakMW = 0;
    let trippedBaseMW = 0;
    let trippedSolarMW = 0;

    sim.activeOutages.forEach(p => {
      const pid = (p.id || "").toLowerCase();
      const cat = (p.category || "").toLowerCase();
      const name = (p.name || "").toLowerCase();
      const fuel = (p.fuel || "").toLowerCase();

      const isMid = pid.includes("ilijan") || pid.includes("midmerit") || cat.includes("ccgt") || cat.includes("midmerit") || cat.includes("mid-merit") || fuel.includes("natural gas") || fuel.includes("lng") || (region.plants.midmerit && pid === region.plants.midmerit.id.toLowerCase());
      
      const isPeak = pid.includes("peaker") || pid.includes("limay") || pid.includes("malaya") || pid.includes("barge") || pid.includes("diesel") || cat.includes("peaking") || cat.includes("peaker") || (region.plants.peaking && pid === region.plants.peaking.id.toLowerCase()) || (region.plants.nonspin && pid === region.plants.nonspin.id.toLowerCase());

      const isSolar = cat.includes("solar") || fuel.includes("solar") || pid.includes("solar");

      if (isMid) {
        trippedMidMW += p.mw;
      } else if (isPeak) {
        trippedPeakMW += p.mw;
      } else if (isSolar) {
        trippedSolarMW += p.mw;
      } else {
        trippedBaseMW += p.mw;
      }
    });

    const midMeritMaxMW = region.plants.midmerit ? region.plants.midmerit.capacityMW : 600;
    const effectiveMidCap = Math.max(0, midMeritMaxMW - trippedMidMW);
    let midMeritActiveMW = Math.max(0, (midMeritMaxMW * 0.75) - trippedMidMW);
    // If surviving mid-merit has headroom and baseload/solar tripped, ramp up surviving mid-merit
    if (effectiveMidCap > 0 && (trippedBaseMW + trippedSolarMW > 0)) {
      midMeritActiveMW = Math.min(effectiveMidCap, midMeritActiveMW + (trippedBaseMW + trippedSolarMW) * 0.35);
    }

    const peakerMaxMW = region.plants.peaking ? region.plants.peaking.capacityMW : 300;
    const effectivePeakerCap = Math.max(0, peakerMaxMW - trippedPeakMW);
    let peakerActiveMW = 0;
    if (effectivePeakerCap > 0) {
      // Energy merit peakers only run during extreme net deficits exceeding total ASPA reserve capacity
      const totalReserveCap = (sim.spinCapacity || 400) + (sim.nonSpinCapacity || 300);
      if (sim.trippedPlantMW > totalReserveCap) {
        peakerActiveMW = Math.min(effectivePeakerCap, (sim.trippedPlantMW - totalReserveCap) * 0.85);
      }
    }

    const baseFleetMaxMW = Math.max(100, region.baseDemandMW - Math.round(midMeritMaxMW * 0.75));
    const currentBaseGen = Math.max(0, baseFleetMaxMW - trippedBaseMW);

    // Dynamic System Demand & ALD (Automatic Load Dropping) Real-time Readouts
    const nominalDemand = region.baseDemandMW || 7500;
    const droppedMW = Math.round(sim.mldTrippedLoad || 0);
    const currentDemand = Math.max(100, Math.round(sim.totalLoad - droppedMW));
    const isAldActive = (sim.mldTriggered || sim.mldStage > 0 || droppedMW > 0);

    const metricDemand = document.getElementById("metric-live-demand");
    const metricDemandDelta = document.getElementById("metric-demand-delta");
    const metricAldShedVal = document.getElementById("metric-ald-shed-val");
    const metricAldStageLbl = document.getElementById("metric-ald-stage-lbl");
    const aldActiveBadge = document.getElementById("ald-active-badge");

    if (metricDemand) {
      metricDemand.textContent = `${currentDemand.toLocaleString()} MW`;
      metricDemand.style.color = isAldActive ? "#F59E0B" : "#0F172A";
    }
    if (metricDemandDelta) {
      if (isAldActive) {
        const pctStr = ((sim.mldPercentage || (droppedMW / nominalDemand)) * 100).toFixed(0);
        metricDemandDelta.textContent = `-${droppedMW.toLocaleString()} MW (${pctStr}% ALD Drop)`;
        metricDemandDelta.style.color = "#DC2626";
      } else {
        metricDemandDelta.textContent = `Nominal: ${nominalDemand.toLocaleString()} MW`;
        metricDemandDelta.style.color = "#64748B";
      }
    }
    if (metricAldShedVal) {
      metricAldShedVal.textContent = isAldActive ? `-${droppedMW.toLocaleString()} MW Shed` : "0 MW Shed";
      metricAldShedVal.style.color = isAldActive ? "#DC2626" : "#059669";
    }
    if (metricAldStageLbl) {
      if (isAldActive) {
        const stageName = typeof sim.mldStage === "number" ? `Stage ${sim.mldStage}` : "Manual ALD";
        const pctStr = ((sim.mldPercentage || (droppedMW / nominalDemand)) * 100).toFixed(0);
        metricAldStageLbl.textContent = `${stageName} (${pctStr}%)`;
        metricAldStageLbl.style.color = "#DC2626";
      } else {
        metricAldStageLbl.textContent = "Armed (59.10 Hz)";
        metricAldStageLbl.style.color = "#64748B";
      }
    }
    const aldAutoDot = document.getElementById("ald-auto-dot");
    const aldAutoBtnLabel = document.getElementById("ald-auto-btn-label");
    if (aldAutoBtnLabel && aldAutoDot) {
      if (sim.autoAldMode) {
        aldAutoBtnLabel.textContent = isAldActive ? `Auto-60Hz: -${droppedMW}M` : "Auto-60Hz: ON";
        aldAutoDot.className = "dot-indicator dot-green";
      } else {
        aldAutoBtnLabel.textContent = "Auto-60Hz: OFF";
        aldAutoDot.className = "dot-indicator dot-amber";
      }
    }

    if (aldActiveBadge) {
      if (isAldActive) {
        aldActiveBadge.className = "badge badge-red";
        aldActiveBadge.textContent = sim.mldStage === "AUTO-60Hz" ? "🎯 AUTO-60Hz ACTIVE" : (typeof sim.mldStage === "number" ? `🚨 ALD STAGE ${sim.mldStage} ACTIVE` : "🚨 ALD ACTIVE");
      } else if (sim.autoAldMode) {
        aldActiveBadge.className = "badge badge-green";
        aldActiveBadge.textContent = "AUTO-60Hz ARMED";
      } else {
        aldActiveBadge.className = "badge badge-green";
        aldActiveBadge.textContent = "ARMED (59.10 Hz)";
      }
    }

    // Update Mini Reserve Meters & Animated Stages in Tab 1
    // 1. BESS FFR & Draining Battery
    if (typeof sim.bessSoC === "undefined") sim.bessSoC = 94.0;
    const ffrCap = sim.ffrCapacity || 150;

    const meterFfr = document.getElementById("meter-ffr");
    const statFfrVal = document.getElementById("stat-ffr-val");
    const statFfrMax = document.getElementById("stat-ffr-max");
    const badgeFfr = document.getElementById("badge-ffr");
    const bessFill = document.getElementById("bess-level-fill");
    const bessSocText = document.getElementById("bess-soc-text");
    const inverterPulse = document.getElementById("inverter-pulse");

    if (meterFfr) meterFfr.style.width = ffrCap > 0 ? ((Math.abs(state.ffrDeployed) / ffrCap) * 100).toFixed(0) + "%" : "0%";
    if (statFfrVal) {
      if (state.ffrDeployed < -2) {
        statFfrVal.textContent = `-${Math.abs(Math.round(state.ffrDeployed))} MW (Chg)`;
        statFfrVal.style.color = "#10B981";
      } else {
        statFfrVal.textContent = `${Math.round(state.ffrDeployed)} MW`;
        statFfrVal.style.color = "";
      }
    }
    if (statFfrMax) statFfrMax.textContent = ffrCap + " MW Cap";
    if (badgeFfr) {
      if (sim.bessSoC <= 10.5) {
        badgeFfr.textContent = "DEPLETED";
      } else if (state.ffrDeployed < -5) {
        badgeFfr.textContent = "FAST CHARGE";
      } else if (state.ffrDeployed > 5) {
        badgeFfr.textContent = "DISCHARGING";
      } else if (sim.bessSoC < 95.0) {
        badgeFfr.textContent = "FLOAT CHG";
      } else {
        badgeFfr.textContent = "STANDBY";
      }
    }

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
      if (sim.bessSoC <= 10.5) {
        inverterPulse.textContent = "⚠️ BESS Depleted";
        inverterPulse.style.color = "#EF4444";
      } else if (state.ffrDeployed < -5) {
        inverterPulse.textContent = `🔋 Over-Freq Fast Charging -${Math.abs(Math.round(state.ffrDeployed))}M`;
        inverterPulse.style.color = "#10B981";
      } else if (state.ffrDeployed > 5) {
        inverterPulse.textContent = `⚡ Discharging +${Math.round(state.ffrDeployed)}M`;
        inverterPulse.style.color = "#818CF8";
      } else if (sim.bessSoC < 95.0) {
        inverterPulse.textContent = `🔋 Float Charging`;
        inverterPulse.style.color = "#10B981";
      } else {
        inverterPulse.textContent = "Inverter Standby";
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

    if (meterReg) meterReg.style.width = regCap > 0 ? (Math.min(100, Math.max(0, Math.abs(state.regDeployed) / regCap * 100))).toFixed(0) + "%" : "0%";
    if (statRegVal) {
      if (state.regDeployed < -2) {
        statRegVal.textContent = `-${Math.abs(Math.round(state.regDeployed))} MW (Down)`;
      } else {
        statRegVal.textContent = `${Math.round(state.regDeployed)} MW`;
      }
    }
    if (statRegMax) statRegMax.textContent = regCap + " MW Cap";
    if (badgeReg) {
      if (state.regDeployed < -5) badgeReg.textContent = "REG-DOWN";
      else if (state.regDeployed > 5) badgeReg.textContent = "REG-UP";
      else badgeReg.textContent = "ACTIVE";
    }

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

    // Dynamic Revenue & Profit Millions Updates for the 4 Reserve Tiers
    const ffrBaseM = (sim.ffrCapacity * 1350000 / 1000000).toFixed(1);
    const regBaseM = (sim.regCapacity * 980000 / 1000000).toFixed(1);
    const spinBaseM = (sim.spinCapacity * 595000 / 1000000).toFixed(1);
    const nonSpinBaseM = (sim.nonSpinCapacity * 680000 / 1000000).toFixed(1);

    const profitFfr = document.getElementById("profit-val-ffr");
    const profitReg = document.getElementById("profit-val-reg");
    const profitSpin = document.getElementById("profit-val-spin");
    const profitNonSpin = document.getElementById("profit-val-nonspin");

    if (profitFfr) profitFfr.textContent = state.ffrDeployed > 5 ? `₱${ffrBaseM}M + ₱${(state.ffrDeployed * 5.5).toFixed(0)}k/h` : `₱${ffrBaseM}M/mo`;
    if (profitReg) profitReg.textContent = Math.abs(state.regDeployed) > 5 ? `₱${regBaseM}M + ₱${(Math.abs(state.regDeployed) * 3.5).toFixed(0)}k/h` : `₱${regBaseM}M/mo`;
    if (profitSpin) profitSpin.textContent = state.spinDeployed > 5 ? `₱${spinBaseM}M + ₱${(state.spinDeployed * 4.5).toFixed(0)}k/h` : `₱${spinBaseM}M/mo`;
    if (profitNonSpin) profitNonSpin.textContent = state.nonSpinDeployed > 5 ? `₱${nonSpinBaseM}M + ₱${(state.nonSpinDeployed * 7.2).toFixed(0)}k/h` : `₱${nonSpinBaseM}M/mo`;

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
    if (vbarValFfr) vbarValFfr.textContent = `${state.ffrDeployed < -1 ? '-' : ''}${Math.round(Math.abs(state.ffrDeployed))}M`;
    if (vbarFillFfr) vbarFillFfr.style.height = `${Math.min(100, Math.max(0, (Math.abs(state.ffrDeployed) / ffrCap) * 100)).toFixed(0)}%`;

    const vbarValReg = document.getElementById("vbar-val-reg");
    const vbarFillReg = document.getElementById("vbar-fill-reg");
    if (vbarValReg) vbarValReg.textContent = `${state.regDeployed < -1 ? '-' : ''}${Math.round(Math.abs(state.regDeployed))}M`;
    if (vbarFillReg) vbarFillReg.style.height = `${Math.min(100, Math.max(0, (Math.abs(state.regDeployed) / regCap) * 100)).toFixed(0)}%`;

    const vbarValSpin = document.getElementById("vbar-val-spin");
    const vbarFillSpin = document.getElementById("vbar-fill-spin");
    if (vbarValSpin) vbarValSpin.textContent = `${Math.round(state.spinDeployed)}M`;
    if (vbarFillSpin) vbarFillSpin.style.height = `${Math.min(100, Math.max(0, (state.spinDeployed / spinCap) * 100)).toFixed(0)}%`;

    const vbarValNonSpin = document.getElementById("vbar-val-nonspin");
    const vbarFillNonSpin = document.getElementById("vbar-fill-nonspin");
    if (vbarValNonSpin) vbarValNonSpin.textContent = `${Math.round(state.nonSpinDeployed)}M`;
    if (vbarFillNonSpin) vbarFillNonSpin.style.height = `${Math.min(100, Math.max(0, (state.nonSpinDeployed / nonSpinCap) * 100)).toFixed(0)}%`;

    const totalActiveGenStack = currentBaseGen + midMeritActiveMW + peakerActiveMW + state.ffrDeployed + state.regDeployed + state.spinDeployed + state.nonSpinDeployed;
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
    const BASE_TOTAL_RATE = 11.7882;
    const BASE_GEN = 6.8900;
    const BASE_AS = 0.4850;
    const BASE_DIST = 2.8500;
    const BASE_TAX = 1.1082;
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
    if (billBaseAmount) billBaseAmount.textContent = `Base: ₱${BASE_MONTHLY_BILL.toFixed(2)} (@ ₱${BASE_TOTAL_RATE.toFixed(4)}/kWh)`;
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
      } else if (typeof HVDC_SYSTEMS !== "undefined" && HVDC_SYSTEMS[plantOrKey]) {
        const hvdc = HVDC_SYSTEMS[plantOrKey];
        plant = {
          name: hvdc.name,
          owner: "National Grid Corporation of the Philippines (NGCP)",
          location: hvdc.location || (hvdc.fromStation + " ⇄ " + hvdc.toStation),
          region: "One Grid Philippines (HVDC Link)",
          type: "±350 kV DC Subsea Transmission",
          capacityMW: hvdc.capacityMW,
          ercCaseNumber: hvdc.ercCaseNumber,
          ercApprovalType: hvdc.ercApprovalType,
          ercRate: hvdc.ercRate,
          wesmRole: hvdc.aspaCategory,
          ercOutageCapDays: hvdc.ercOutageCapDays || 7.5,
          ercShowCauseOrder: hvdc.ercShowCauseOrder,
          ercPenaltyBase: hvdc.ercPenaltyBase,
          unexcusedPenaltyPerHour: hvdc.unexcusedPenaltyPerHour,
          statutoryNotes: hvdc.summary
        };
        legalRole = "hvdc";
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
        logTerminal("PLANT-RESTORE", `✓ <strong>${plant.name}</strong> [52A-CLOSE]: Unit resynchronized (+${plant.mw} MW). Remaining grid deficit: <strong>-${sim.trippedPlantMW} MW</strong>.`, "term-tag-restore");
        playBeep(520, "sine", 0.12);
      } else {
        sim.tripPlant(plant);
        logTerminal("PLANT-TRIP", `💥 <strong>${plant.name}</strong> [BREAKER 52A TRIP]: FORCED OUTAGE (-${plant.mw} MW lost)! Grid deficit: <strong>-${sim.trippedPlantMW} MW</strong>.`, "term-tag-alert");
        logTerminal("ERC-AUDIT", `⚖️ <strong>${plant.ercCaseNumber || "ERC Res 10-2020"}</strong>: Unscheduled trip. Penalty accrual rate: <strong class="term-penalty">₱${(plant.unexcusedPenaltyPerHour || 125000).toLocaleString()}/hr</strong>.`, "term-tag-erc");
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
      logTerminal("RANDOM-TRIP", `💥 <strong>${chosenPlant.name}</strong> [FORCED CONTINGENCY]: Breaker 52A open (-${chosenPlant.mw} MW lost at ${chosenPlant.location})! Total Grid Loss: <strong>-${sim.trippedPlantMW} MW</strong>.`, "term-tag-alert");
      logTerminal("ERC-AUDIT", `⚖️ Grid disturbance logged under <strong>${chosenPlant.ercCaseNumber || "ERC Res 10-2020"}</strong>. Penalty rate: <strong class="term-penalty">₱${(chosenPlant.unexcusedPenaltyPerHour || 125000).toLocaleString()}/hr</strong>.`, "term-tag-erc");
      playBeep(180, "sawtooth", 0.45);
    } else {
      sim.clearContingency();
      chosenPlant = plantList[Math.floor(Math.random() * plantList.length)];
      sim.tripPlant(chosenPlant);
      logTerminal("RANDOM-TRIP", `🔄 Grid reset & fresh random contingency on <strong>${chosenPlant.name}</strong> (-${chosenPlant.mw} MW lost)!`, "term-tag-alert");
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

  // Automatic Load Dropping (ALD / UFLS) Triggers & Feeder Restoration
  document.getElementById("btn-toggle-auto-ald")?.addEventListener("click", () => {
    const isAuto = sim.toggleAutoAldMode();
    if (isAuto) {
      logTerminal("ALD-AUTO", `🎯 <strong>Auto-60Hz ALD Protection ENABLED</strong> (Default). SCADA will automatically shed exact deficit to maintain 60.00 Hz.`, "term-tag-info");
      playBeep(520, "sine", 0.12);
    } else {
      logTerminal("ALD-MANUAL", `⚠️ <strong>Auto-60Hz ALD DISABLED</strong>. Switched to stepped manual protection.`, "term-tag-dispatch");
      playBeep(440, "sine", 0.12);
    }
  });

  document.getElementById("btn-ald-stage-1")?.addEventListener("click", () => {
    sim.triggerALD(1);
    logTerminal("ALD-DISPATCH", `🚨 <strong>ALD STAGE 1 EXECUTED</strong>: 15% demand dropped (-${Math.round(sim.mldTrippedLoad)} MW) across feeders.`, "term-tag-alert");
    playBeep(140, "sawtooth", 0.5);
  });

  document.getElementById("btn-ald-stage-2")?.addEventListener("click", () => {
    sim.triggerALD(2);
    logTerminal("ALD-DISPATCH", `🚨 <strong>ALD STAGE 2 EXECUTED</strong>: 30% demand dropped (-${Math.round(sim.mldTrippedLoad)} MW) across feeders.`, "term-tag-alert");
    playBeep(120, "sawtooth", 0.6);
  });

  document.getElementById("btn-ald-auto-60")?.addEventListener("click", () => {
    const shedPct = sim.triggerAutoRestore60HzALD();
    logTerminal("ALD-SMART", `🎯 <strong>AUTO-RESTORE 60Hz ALD</strong>: Dropped ${(shedPct * 100).toFixed(1)}% demand (-${Math.round(sim.mldTrippedLoad)} MW) to restore 60.00 Hz nominal grid frequency!`, "term-tag-alert");
    playBeep(320, "sine", 0.35);
  });

  document.getElementById("btn-restore-ald")?.addEventListener("click", () => {
    sim.restoreALD();
    logTerminal("ALD-RESTORE", `✓ <strong>ALD FEEDERS RECLOSED</strong>: System demand fully restored to nominal load.`, "term-tag-info");
    playBeep(580, "sine", 0.12);
  });

  document.getElementById("btn-manual-mld-10")?.addEventListener("click", () => {
    sim.triggerALD(1);
    playBeep(140, "sawtooth", 0.5);
  });

  document.getElementById("btn-manual-mld-20")?.addEventListener("click", () => {
    sim.triggerALD(2);
    playBeep(120, "sawtooth", 0.6);
  });

  document.getElementById("btn-restore-mld")?.addEventListener("click", () => {
    sim.restoreALD();
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
    smoothedFreqMin = 59.85;
    smoothedFreqMax = 60.15;
    setRegionalGrid(currentRegionKey);
    logTerminal("RESET", `✓ Entire grid simulation reset to 60.00 Hz steady-state for ${currentRegionKey.toUpperCase()}.`, "term-tag-info");
    playBeep(440, "sine", 0.1);
  }

  document.querySelectorAll("#btn-reset-all, .btn-reset-sim").forEach(btn => {
    btn.addEventListener("click", executeSimulationReset);
  });

  // --- 7. MAIN SIMULATION 60 FPS LOOP & PERIODIC SCADA TELEMETRY STREAM ---
  let lastTime = performance.now();
  let lastAgcLogTime = 0;
  let lastWesmLogTime = 0;
  let lastPmuLogTime = 0;
  let lastBessLogTime = 0;

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

      const region = REGIONAL_GRIDS[currentRegionKey] || REGIONAL_GRIDS.luzon;
      const nominal = sim.nominalFreq || 60.0;
      const freqDev = sim.freq - nominal;
      const aceMW = -(freqDev * 10 * 12); // Area Control Error (ACE in MW)

      // Calculate dynamic WESM LMP price
      let wesmLmpPrice = 4850.00;
      if (sim.trippedPlantMW > 0) {
        const outageSeverity = Math.min(1.0, sim.trippedPlantMW / 1200);
        wesmLmpPrice = 4850.00 + outageSeverity * 9500.00;
      }
      if (state.nonSpinDeployed > 10) {
        wesmLmpPrice += (state.nonSpinDeployed / Math.max(10, sim.nonSpinCapacity)) * 6500.00;
      }

      // Update Terminal Live KPI Bar
      if (termKpiAgc) {
        if (Math.abs(freqDev) > 0.20) {
          termKpiAgc.textContent = "EMERGENCY CORRECTION";
          termKpiAgc.className = "kpi-val kpi-red";
        } else if (Math.abs(freqDev) > 0.05) {
          termKpiAgc.textContent = "RAMPING ACTIVE (4s)";
          termKpiAgc.className = "kpi-val kpi-amber";
        } else {
          termKpiAgc.textContent = "CLOSED-LOOP AUTO (4s)";
          termKpiAgc.className = "kpi-val kpi-green";
        }
      }

      if (termKpiAce) {
        termKpiAce.textContent = `${aceMW >= 0 ? '+' : ''}${aceMW.toFixed(1)} MW`;
        termKpiAce.style.color = Math.abs(aceMW) > 50 ? "#EF4444" : (Math.abs(aceMW) > 15 ? "#F59E0B" : "#10B981");
      }

      if (termKpiLmp) {
        termKpiLmp.textContent = `₱${wesmLmpPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}/MWh`;
        termKpiLmp.style.color = wesmLmpPrice > 8000 ? "#EF4444" : (wesmLmpPrice > 5500 ? "#F59E0B" : "#6366F1");
      }

      if (termKpiRocof) {
        termKpiRocof.textContent = `${state.rocof >= 0 ? '+' : ''}${state.rocof.toFixed(2)} Hz/s`;
        termKpiRocof.style.color = Math.abs(state.rocof) > 0.2 ? "#EF4444" : "#F8FAFC";
      }

      // --- PERIODIC SCADA TELEMETRY LOG BROADCASTS ---
      // 1. Periodic AGC 4-Second Closed Loop SCADA Telemetry (Every 4.2s)
      if (sim.time - lastAgcLogTime >= 4.2) {
        lastAgcLogTime = sim.time;
        const regPlant = region.plants.reg ? region.plants.reg.name : "Regulating Hydro";
        const gatePct = Math.min(100, Math.max(20, Math.round(30 + (Math.abs(state.regDeployed) / Math.max(10, sim.regCapacity)) * 70)));
        
        if (Math.abs(freqDev) > 0.02) {
          const regAction = state.regDeployed < -2 ? "REG-DOWN (Lower Gate)" : (state.regDeployed > 2 ? "REG-UP (Raise Gate)" : "REG-HOLD");
          logTerminal("AGC-PULSE", `⚡ <strong>AGC Loop ${regPlant}</strong>: ${regAction} [${Math.abs(Math.round(state.regDeployed))} MW]. ACE: <strong>${aceMW >= 0 ? '+' : ''}${aceMW.toFixed(1)} MW</strong> | Gate: ${gatePct}% | Δf: ${freqDev >= 0 ? '+' : ''}${freqDev.toFixed(3)} Hz.`, "term-tag-agc");
        } else {
          logTerminal("SCADA-EMS", `✓ <strong>AGC Steady-State</strong>: Grid ACE at <strong>${aceMW >= 0 ? '+' : ''}${aceMW.toFixed(1)} MW</strong>. 60.00 Hz nominal tracking normal. Telemetry sync OK.`, "term-tag-scada");
        }
      }

      // 2. Periodic WESM 5-Minute RTM Co-Optimization Settlement Log (Every 6.8s)
      if (sim.time - lastWesmLogTime >= 6.8) {
        lastWesmLogTime = sim.time;
        const spinMW = Math.round(state.spinDeployed);
        const nonSpinMW = Math.round(state.nonSpinDeployed);
        const ffrMW = Math.round(state.ffrDeployed);

        if (sim.trippedPlantMW > 0 || wesmLmpPrice > 5200) {
          logTerminal("WESM-RTM", `📈 <strong>WESM 5-Min Co-Opt RTM</strong>: Ex-Ante LMP: <strong class="term-cost">₱${wesmLmpPrice.toFixed(2)}/MWh</strong>. Spin MCPR: ₱${(826 + (spinMW * 4.5)).toFixed(0)}/MWh | Non-Spin Peakers: +${nonSpinMW} MW cleared.`, "term-tag-wesm");
        } else {
          logTerminal("WESM-RTM", `📈 <strong>WESM 5-Min Co-Opt RTM</strong>: LMP: <strong class="term-cost">₱${wesmLmpPrice.toFixed(2)}/MWh</strong>. Merit Order Baseload Cleared: 100%. Reserve MCPRs: FFR ₱1,875 | Reg ₱1,361 | Spin ₱826/MWh.`, "term-tag-wesm");
        }
      }

      // 3. Periodic Synchrophasor PMU & HVDC Corridor Telemetry Log (Every 9.5s)
      if (sim.time - lastPmuLogTime >= 9.5) {
        lastPmuLogTime = sim.time;
        const busVolt500kV = (515.0 + (Math.sin(sim.time * 0.4) * 3.5)).toFixed(1);
        const busVolt230kV = (232.0 + (Math.cos(sim.time * 0.6) * 2.2)).toFixed(1);
        const phaseDeltaDeg = (12.4 + (sim.trippedPlantMW / 120)).toFixed(1);

        if (currentRegionKey === "luzon") {
          logTerminal("PMU-SCADA", `📡 <strong>PMU Synchrophasor</strong>: San Jose 500kV Bus: <strong>${busVolt500kV} kV</strong> | Dasmariñas 230kV: <strong>${busVolt230kV} kV</strong> | Phase Angle $\\delta$: ${phaseDeltaDeg}° | Leyte-Luzon HVDC: 320 MW transfer.`, "term-tag-pmu");
        } else if (currentRegionKey === "visayas") {
          logTerminal("PMU-SCADA", `📡 <strong>PMU Synchrophasor</strong>: Compostela 230kV Bus: <strong>${busVolt230kV} kV</strong> | MVIP Santander HVDC: 250 MW flow | Unified Leyte Geo: 80 MW AGC sync.`, "term-tag-pmu");
        } else {
          logTerminal("PMU-SCADA", `📡 <strong>PMU Synchrophasor</strong>: Kauswagan 230kV Bus: <strong>${busVolt230kV} kV</strong> | Lala MVIP Converter: 250 MW export | Agus-Pulangi Hydro: 180 MW online.`, "term-tag-pmu");
        }
      }

      // 4. BESS Fast Charging / Discharging Telemetry Broadcast
      if (Math.abs(state.ffrDeployed) > 10 && (sim.time - lastBessLogTime >= 3.0)) {
        lastBessLogTime = sim.time;
        const bessPlant = region.plants.ffr ? region.plants.ffr.name : "BESS Storage";
        if (state.ffrDeployed < -5) {
          logTerminal("BESS-FFR", `🔋 <strong>${bessPlant} High-Freq Action</strong>: Absorbing <strong class="term-num">-${Math.abs(Math.round(state.ffrDeployed))} MW</strong> (<200ms). Battery SoC: <strong>${sim.bessSoC.toFixed(1)}%</strong> | Inverter Bus: 825V DC.`, "term-tag-bess");
        } else {
          logTerminal("BESS-FFR", `🔋 <strong>${bessPlant} Fast Injection</strong>: Delivering <strong class="term-num">+${Math.round(state.ffrDeployed)} MW</strong> in <200ms. Battery SoC: <strong>${sim.bessSoC.toFixed(1)}%</strong>. Arrested RoCoF.`, "term-tag-bess");
        }
      }

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
        const effectiveLoad = Math.max(100, sim.totalLoad - (sim.mldTrippedLoad || 0));
        const net = Math.round(sim.totalGen - effectiveLoad - sim.trippedPlantMW + (sim.ffrDeployed + Math.abs(sim.regDeployed) + sim.spinDeployed + sim.nonSpinDeployed));
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
  renderFleetDirectory();
  requestAnimationFrame(loop);
});
