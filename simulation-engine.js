// ============================================================================
// RESERVE MARKET & GRID FREQUENCY SIMULATION ENGINE
// Real-time Physics ODE Solver + Market Co-Optimization & ASPA Settlement Engine
// ============================================================================

class GridPhysicsSimulator {
  constructor() {
    this.resetDefaults();
  }

  resetDefaults() {
    // Nominal Parameters
    this.nominalFreq = 60.0; // Hz (or 50.0)
    this.freq = 60.0;
    this.deltaFreq = 0.0;
    this.time = 0.0;
    this.dt = 0.05; // 50ms integration step for smooth 60fps simulation
    
    // System Capacity & Inertia
    this.systemBaseMVA = 10000; // MW total grid active capacity
    this.totalLoad = 7500; // MW initial demand
    this.totalGen = 7500; // MW initial generation
    this.inertiaH = 4.5; // Inertia constant (seconds)
    this.loadDampingD = 1.5; // % load change per % freq change (p.u.)
    
    // Reserve Allocations & Settings
    this.ffrCapacity = 150; // MW BESS / FFR
    this.ffrActive = true;
    this.ffrDeployed = 0;
    this.ffrThreshold = 0.02; // Hz drop deadband (59.98 Hz / 60.02 Hz per PGC FFR standard)
    this.ffrTimeConstant = 0.8; // 800ms smooth realistic inverter slew rate
    this.bessSoC = 92.0; // % State of Charge
    this.bessEnergyMWh = 150; // 1-hour C-rate storage base

    this.regCapacity = 200; // MW AGC Regulation
    this.regActive = true;
    this.regDeployed = 0;
    this.agcKp = 0.40;
    this.agcKi = 0.06;
    this.agcIntegral = 0;
    this.regRampRate = 40; // MW/min

    this.spinCapacity = 400; // MW Spinning / Synchronized Reserve
    this.spinActive = true;
    this.spinDeployed = 0;
    this.governorDroop = 0.04; // 4% droop
    this.govTimeConstant = 0.8; // sec
    this.turbineTimeConstant = 2.4; // sec

    this.nonSpinCapacity = 300; // MW Quick-Start Peakers
    this.nonSpinActive = false;
    this.nonSpinAutoMode = true; // Auto-dispatch peakers by default
    this.nonSpinDeployed = 0;
    this.nonSpinTimer = 0;

    // Disturbance / Multi-Plant Outages & Contingencies
    this.activeOutages = []; // Array of { id, name, mw, category, fuel, time }
    this.trippedPlantMW = 0;
    this.activeContingency = null;

    // Load Dropping: UFLS (Automatic) & MLD (Manual Load Dropping)
    this.autoAldMode = true; // Auto-60Hz Adaptive ALD enabled by default
    this.mldTriggered = false;
    this.mldStage = 0; // 0 = Normal, 1 = UFLS Stage 1, 2 = UFLS Stage 2, 3 = UFLS Stage 3, 'AUTO-60Hz' = Smart ALD
    this.mldTrippedLoad = 0;
    this.mldPercentage = 0;
    this.lastMldLoggedStage = 0;

    // Time-series History Buffer (for charts) - Seed with initial 20 nominal data points
    this.history = {
      time: Array.from({ length: 20 }, (_, i) => -1.0 + i * 0.05),
      freq: Array.from({ length: 20 }, () => this.nominalFreq),
      rocof: Array.from({ length: 20 }, () => 0.0),
      genTotal: Array.from({ length: 20 }, () => this.totalGen),
      loadTotal: Array.from({ length: 20 }, () => this.totalLoad),
      ffrPower: Array.from({ length: 20 }, () => 0.0),
      regPower: Array.from({ length: 20 }, () => 0.0),
      spinPower: Array.from({ length: 20 }, () => 0.0),
      nonSpinPower: Array.from({ length: 20 }, () => 0.0),
      events: []
    };
  }

  setGridFrequencyStandard(hz) {
    this.nominalFreq = hz;
    this.freq = hz;
    this.deltaFreq = 0.0;
  }

  // Multi-Plant Tripping Management
  tripPlant(plantObj) {
    // Avoid duplicate trips of same plant
    const existingIdx = this.activeOutages.findIndex(p => p.id === plantObj.id);
    if (existingIdx >= 0) return false;

    const outage = {
      id: plantObj.id,
      name: plantObj.name,
      mw: plantObj.mw,
      category: plantObj.category || "Plant Outage",
      fuel: plantObj.fuel || "Thermal",
      location: plantObj.location || "Grid Substation",
      time: this.time
    };

    this.activeOutages.push(outage);
    this.recalculateTrippedMW();

    this.activeContingency = {
      type: plantObj.category === "Grid Storm" ? "storm" : "trip",
      magnitudeMW: this.trippedPlantMW,
      time: this.time,
      label: plantObj.name
    };

    this.history.events.push({
      time: this.time,
      text: `⚡ PLANT TRIP: ${plantObj.name} (-${plantObj.mw} MW lost at ${outage.location})`
    });

    return true;
  }

  untripPlant(plantId) {
    const idx = this.activeOutages.findIndex(p => p.id === plantId);
    if (idx >= 0) {
      const removed = this.activeOutages.splice(idx, 1)[0];
      this.recalculateTrippedMW();
      this.history.events.push({
        time: this.time,
        text: `✓ PLANT RESTORED: ${removed.name} (+${removed.mw} MW reconnected)`
      });
      return true;
    }
    return false;
  }

  recalculateTrippedMW() {
    this.trippedPlantMW = this.activeOutages.reduce((sum, p) => sum + p.mw, 0);
    if (this.activeOutages.length === 0) {
      this.activeContingency = null;
    }
  }

  // Trigger Custom Contingency (Backwards compatibility)
  triggerContingency(type, magnitudeMW, label = "Contingency Event") {
    const customId = "custom_" + Math.random().toString(36).substring(2, 7);
    this.tripPlant({
      id: customId,
      name: label,
      mw: magnitudeMW,
      category: type === "storm" ? "Grid Storm" : "Contingency",
      fuel: "Thermal",
      location: "Regional Bulk Grid"
    });
  }

  // Reset all outages
  clearContingency() {
    this.activeOutages = [];
    this.trippedPlantMW = 0;
    this.activeContingency = null;
  }

  // Automatic Load Dropping (ALD / UFLS) & Auto-Restore 60Hz Methods
  triggerALD(stage = 1) {
    this.mldTriggered = true;
    this.mldStage = stage;
    const stagePcts = { 1: 0.15, 2: 0.30, 3: 0.45 };
    const pct = typeof stage === "number" && stage < 1.0 ? stage : (stagePcts[stage] || 0.15);
    this.mldPercentage = pct;
    this.mldTrippedLoad = this.totalLoad * pct;
    this.history.events.push({
      time: this.time,
      text: `🚨 AUTOMATIC LOAD DROPPING (ALD Stage ${typeof stage === "number" && stage < 1.0 ? (pct * 100).toFixed(0) + '%' : stage}): Shed ${(pct * 100).toFixed(0)}% grid demand (-${this.mldTrippedLoad.toFixed(0)} MW) to arrest frequency decay!`
    });
  }

  // Smart Adaptive ALD: Sized specifically to restore grid frequency to ~60.00 Hz
  triggerAutoRestore60HzALD() {
    const activeBaseGen = Math.max(0, this.totalGen - this.trippedPlantMW);
    const activeReserves = Math.max(0, this.ffrDeployed) + Math.max(0, this.regDeployed) + this.spinDeployed + this.nonSpinDeployed;
    const totalGenActive = activeBaseGen + activeReserves;
    
    // Calculate required load shed so active generation satisfies demand
    const generationDeficitMW = Math.max(50, this.totalLoad - totalGenActive);
    const targetShedPct = Math.min(0.80, Math.max(0.05, (generationDeficitMW / this.totalLoad) + 0.015));
    
    this.mldTriggered = true;
    this.mldStage = "AUTO-60Hz";
    this.mldPercentage = targetShedPct;
    this.mldTrippedLoad = this.totalLoad * targetShedPct;
    
    this.history.events.push({
      time: this.time,
      text: `🎯 AUTO-RESTORE 60Hz ALD: Dropped ${(targetShedPct * 100).toFixed(1)}% demand (-${this.mldTrippedLoad.toFixed(0)} MW) to balance system at 60.00 Hz!`
    });
    return targetShedPct;
  }

  // Manual Load Dropping (MLD) / ALD Trigger
  triggerManualMLD(pct = 0.15) {
    this.triggerALD(pct);
  }

  // Automatic ALD Mode Toggle
  toggleAutoAldMode() {
    this.autoAldMode = !this.autoAldMode;
    return this.autoAldMode;
  }

  // Restore Dropped Load (Reclose Feeders)
  restoreALD() {
    this.mldTriggered = false;
    this.mldStage = 0;
    this.mldPercentage = 0;
    this.mldTrippedLoad = 0;
    this.lastMldLoggedStage = 0;
    this.history.events.push({
      time: this.time,
      text: `✓ DEMAND RESTORED: All Automatic Load Dropping (ALD / UFLS) feeder breakers reclosed across distribution utilities.`
    });
  }

  restoreMLD() {
    this.restoreALD();
  }

  // Peaker Control Methods
  toggleNonSpinAuto() {
    this.nonSpinAutoMode = !this.nonSpinAutoMode;
    return this.nonSpinAutoMode;
  }

  toggleNonSpinManual() {
    this.nonSpinActive = !this.nonSpinActive;
    if (this.nonSpinActive) {
      this.history.events.push({
        time: this.time,
        text: `🚀 MANUAL DISPATCH: Operator manually dispatched Tertiary Peakers (+${this.nonSpinCapacity} MW).`
      });
    } else {
      this.history.events.push({
        time: this.time,
        text: `🛑 MANUAL SHUTDOWN: Operator manually shut down Tertiary Peakers.`
      });
    }
    return this.nonSpinActive;
  }

  // Runge-Kutta / Semi-Implicit ODE Step for the Grid Swing Equation
  step(dt) {
    if (typeof dt === "number" && dt > 0 && dt < 0.2) {
      this.dt = dt;
    } else {
      this.dt = 0.05;
    }
    this.time += this.dt;
    
    // Check for storm gust fluctuations
    let stormFluctuationMW = 0;
    const hasStorm = this.activeOutages.some(p => p.category === "Grid Storm");
    if (hasStorm) {
      stormFluctuationMW = (Math.sin(this.time * 1.8) * 0.18 + Math.cos(this.time * 3.4) * 0.12 + (Math.random() - 0.5) * 0.08) * (this.trippedPlantMW * 0.4);
    }

    // Realistic stochastic load fluctuation (Ornstein-Uhlenbeck Process + Micro-Jitter)
    if (typeof this.loadNoiseMW === "undefined") this.loadNoiseMW = 0;
    const noiseDecay = 0.88;
    const noiseDiffusion = (Math.random() - 0.5) * (this.totalLoad * 0.0032);
    this.loadNoiseMW = (this.loadNoiseMW * noiseDecay) + noiseDiffusion;
    const harmonicNoiseMW = (Math.sin(this.time * 0.85) * 0.45 + Math.cos(this.time * 1.45) * 0.35 + Math.sin(this.time * 2.8) * 0.2) * (this.totalLoad * 0.0022);
    const totalStochasticNoiseMW = this.loadNoiseMW + harmonicNoiseMW;

    // Nominal surviving baseload & mid-merit generation before governor modulation
    let currentBaseGen = Math.max(0, this.totalGen - (this.trippedPlantMW + stormFluctuationMW));

    // --- OVER-FREQUENCY GENERATOR ACTION / GOVERNOR DE-LOADING (PGC Section 4.5.2) ---
    // When frequency rises above 60.02 Hz (due to ALD load shedding or generation surplus),
    // surviving baseload and mid-merit power plants automatically throttle back their steam/gas turbines
    if (this.freq > (this.nominalFreq + 0.02) && currentBaseGen > 100) {
      const freqExcess = this.freq - (this.nominalFreq + 0.02);
      const pUnitExcess = freqExcess / this.nominalFreq;
      const govDeloadFraction = Math.min(0.40, (pUnitExcess / this.governorDroop));
      const govDeloadMW = currentBaseGen * govDeloadFraction;
      currentBaseGen = Math.max(100, currentBaseGen - govDeloadMW);
    }

    const currentEffectiveLoad = Math.max(100, this.totalLoad - this.mldTrippedLoad + totalStochasticNoiseMW);
    const freqDrop = this.nominalFreq - this.freq; // Positive on under-frequency, Negative on over-frequency
    const isFfrTripped = this.activeOutages.some(p => (p.id || "").toLowerCase().includes("bess") || (p.id || "").toLowerCase().includes("masinloc_bess"));
    
    // Dynamic Battery SoC Available Discharge Factor:
    const socAvailableFactor = this.bessSoC <= 10.0 ? 0.0 : Math.min(1.0, Math.max(0.0, (this.bessSoC - 10.0) / 20.0));
    const effectiveFfrCap = (this.ffrActive && !isFfrTripped) ? (this.ffrCapacity * socAvailableFactor) : 0;

    // --- 1. FAST FREQUENCY RESPONSE (BESS FFR - BIDIRECTIONAL DISCHARGE & CHARGE) ---
    let targetFFR = 0;
    if (effectiveFfrCap > 0) {
      if (freqDrop > this.ffrThreshold) {
        // Under-frequency (f < 59.98 Hz): Smooth proportional inverter discharge up to +effectiveFfrCap
        const deltaActive = freqDrop - this.ffrThreshold;
        targetFFR = Math.min(effectiveFfrCap, (deltaActive / 0.15) * effectiveFfrCap);
      } else if (freqDrop < -this.ffrThreshold && this.bessSoC < 98.0) {
        // Over-frequency (f > 60.02 Hz): Smooth fast charging absorption up to -ffrCapacity
        const overFreq = -freqDrop - this.ffrThreshold;
        targetFFR = -Math.min(this.ffrCapacity, (overFreq / 0.15) * this.ffrCapacity);
      }
    }
    // Realistic smooth first-order inverter filter (slew rate)
    const ffrTau = Math.max(0.1, this.ffrTimeConstant);
    this.ffrDeployed += (targetFFR - this.ffrDeployed) * (this.dt / ffrTau);
    this.ffrDeployed = Math.max(-this.ffrCapacity, Math.min(effectiveFfrCap, this.ffrDeployed));

    // Dynamic Battery State of Charge (SoC %) physics
    if (this.ffrDeployed > 0.5) {
      const dischargeRatePerSec = (this.ffrDeployed / Math.max(10, this.ffrCapacity)) * 0.45;
      this.bessSoC = Math.max(10.0, this.bessSoC - dischargeRatePerSec * this.dt);
    } else if (this.ffrDeployed < -0.5) {
      const chargeRatePerSec = (Math.abs(this.ffrDeployed) / Math.max(10, this.ffrCapacity)) * 0.45;
      this.bessSoC = Math.min(99.0, this.bessSoC + chargeRatePerSec * this.dt);
    } else if (Math.abs(freqDrop) < 0.02 && this.bessSoC < 95.0) {
      this.bessSoC = Math.min(95.0, this.bessSoC + 0.12 * this.dt);
    }

    // --- 2. PRIMARY GOVERNOR DROOP RESPONSE (CR-SPINNING) ---
    let targetSpin = 0;
    if (this.spinActive) {
      if (freqDrop > 0.02) {
        // Under-frequency governor boost (Spinning Reserve Headroom)
        const pUnitDrop = freqDrop / this.nominalFreq;
        targetSpin = Math.min(this.spinCapacity, (pUnitDrop / this.governorDroop) * this.systemBaseMVA * 0.15);
      } else {
        targetSpin = 0; // Governors are back at base setpoint
      }
    }
    const dSpin = (targetSpin - this.spinDeployed) / (this.govTimeConstant + this.turbineTimeConstant);
    this.spinDeployed += dSpin * this.dt;
    this.spinDeployed = Math.max(0, Math.min(this.spinCapacity, this.spinDeployed));

    // --- 3. SECONDARY RESPONSE (AGC REGULATION: REG-UP & REG-DOWN) ---
    if (this.regActive) {
      // Area Control Error (ACE in MW): Positive when under-frequency (generation deficit), Negative when over-frequency
      const aceMW = freqDrop * 10 * 18;
      
      if (Math.abs(freqDrop) > 0.01) {
        this.agcIntegral += aceMW * this.dt;
        this.agcIntegral = Math.max(-this.regCapacity * 2, Math.min(this.regCapacity * 2, this.agcIntegral));
        
        let targetReg = (this.agcKp * aceMW) + (this.agcKi * this.agcIntegral);
        // Bidirectional: Can provide Regulation-Down (-regCapacity) or Regulation-Up (+regCapacity)
        targetReg = Math.max(-this.regCapacity, Math.min(this.regCapacity, targetReg));
        
        // Smooth realistic hydro wicket gate slew dynamic (~3.5s time constant)
        const regTau = 3.5;
        const dReg = (targetReg - this.regDeployed) / regTau;
        this.regDeployed += dReg * this.dt;
        this.regDeployed = Math.max(-this.regCapacity, Math.min(this.regCapacity, this.regDeployed));
      } else {
        this.agcIntegral *= 0.98;
        this.regDeployed *= 0.98;
        if (Math.abs(this.regDeployed) < 0.2) this.regDeployed = 0;
      }
    } else {
      this.regDeployed = 0;
      this.agcIntegral = 0;
    }

    // --- 4. TERTIARY RESPONSE (NON-SPINNING PEAKERS) ---
    if (this.nonSpinAutoMode) {
      const needsPeakers = (this.trippedPlantMW > 100 && this.freq <= (this.nominalFreq - 0.05)) || 
                           (this.spinDeployed > this.spinCapacity * 0.60) || 
                           (this.freq < (this.nominalFreq - 0.12));

      // Over-frequency or stabilized: Shut down peakers smoothly
      const peakersShouldStop = (this.freq >= (this.nominalFreq + 0.02)) || 
                                (this.trippedPlantMW === 0 && Math.abs(this.freq - this.nominalFreq) < 0.03 && this.spinDeployed < 15);

      if (needsPeakers) {
        if (!this.nonSpinActive) {
          this.nonSpinActive = true;
          this.history.events.push({
            time: this.time,
            text: `🚀 AUTO-DISPATCH ACTIVE: NGCP SCADA automatically started Tertiary Peakers (+${this.nonSpinCapacity} MW) to replace lost generation.`
          });
        }
      } else if (peakersShouldStop) {
        if (this.nonSpinActive) {
          this.nonSpinActive = false;
        }
      }
    }

    if (this.nonSpinActive && this.freq < (this.nominalFreq + 0.05)) {
      this.nonSpinTimer += this.dt;
      const targetMW = this.trippedPlantMW > 0 ? Math.min(this.nonSpinCapacity, this.trippedPlantMW) : this.nonSpinCapacity;
      const rampFraction = Math.min(1.0, this.nonSpinTimer / 8.0);
      this.nonSpinDeployed = targetMW * rampFraction;
    } else {
      if (this.nonSpinDeployed > 0) {
        this.nonSpinTimer = Math.max(0, this.nonSpinTimer - this.dt * 4.0);
        this.nonSpinDeployed = Math.max(0, this.nonSpinCapacity * (this.nonSpinTimer / 8.0));
      } else {
        this.nonSpinTimer = 0;
        this.nonSpinDeployed = 0;
      }
    }

    // Total active generation power
    const totalActiveGenMW = currentBaseGen + this.ffrDeployed + this.spinDeployed + this.regDeployed + this.nonSpinDeployed;
    
    // Load frequency damping effect: D * delta_f
    const dampingMW = this.loadDampingD * (currentEffectiveLoad / this.nominalFreq) * (this.freq - this.nominalFreq);
    const totalDampedLoadMW = currentEffectiveLoad + dampingMW;

    // Power mismatch in Per-Unit of Base MVA
    const powerMismatchPU = (totalActiveGenMW - totalDampedLoadMW) / this.systemBaseMVA;

    // Swing Equation: 2 * H * (d f / dt) = P_gen - P_load (in p.u.)
    const rocof = (this.nominalFreq / (2.0 * Math.max(0.5, this.inertiaH))) * powerMismatchPU;
    
    // Integrate frequency
    this.freq += rocof * this.dt;
    this.deltaFreq = this.freq - this.nominalFreq;

    // --- 5. ADAPTIVE AUTO-60Hz ALD PROTECTION & AUTO-RECLOSE FEEDERS ---
    if (this.autoAldMode) {
      const activeTotalGen = currentBaseGen + Math.max(0, this.ffrDeployed) + this.spinDeployed + Math.max(0, this.regDeployed) + this.nonSpinDeployed;
      const genDeficitMW = this.totalLoad - activeTotalGen;
      const totalReserveCap = (this.ffrCapacity || 150) + (this.regCapacity || 200) + (this.spinCapacity || 400) + (this.nonSpinCapacity || 300);

      // ALD is emergency protection: triggers only if frequency falls below 59.20 Hz or catastrophic outage exceeds reserves
      const isSevereEmergency = (this.freq < (this.nominalFreq - 0.80)) || 
                               (this.trippedPlantMW > totalReserveCap && this.freq < (this.nominalFreq - 0.40));

      if (isSevereEmergency) {
        const requiredShedMW = Math.max(100, genDeficitMW + Math.max(0, this.nominalFreq - this.freq) * (this.totalLoad / this.nominalFreq) * 1.8);
        const targetShedPct = Math.min(0.85, Math.max(0.10, requiredShedMW / this.totalLoad));
        
        if (targetShedPct > (this.mldPercentage + 0.02) || !this.mldTriggered) {
          this.mldTriggered = true;
          this.mldStage = "AUTO-60Hz";
          this.mldPercentage = targetShedPct;
          this.mldTrippedLoad = this.totalLoad * targetShedPct;
          this.history.events.push({
            time: this.time,
            text: `🚨 EMERGENCY ALD SHED @ ${this.freq.toFixed(2)} Hz: -${this.mldTrippedLoad.toFixed(0)} MW (${(targetShedPct * 100).toFixed(0)}%) dropped to arrest grid collapse!`
          });
        }
      } 
      // Case B: Generation surplus / Frequency recovered -> Auto-Reclose Feeders smoothly!
      else if (this.mldTrippedLoad > 0 && this.freq >= (this.nominalFreq - 0.05)) {
        const restoreStepMW = Math.max(8, (this.freq - (this.nominalFreq - 0.05)) * 250 * this.dt);
        this.mldTrippedLoad = Math.max(0, this.mldTrippedLoad - restoreStepMW);
        this.mldPercentage = this.mldTrippedLoad / this.totalLoad;
        if (this.mldTrippedLoad < 15) {
          this.restoreALD();
        }
      }
    }

    // --- 6. AUTOMATIC UNDER-FREQUENCY LOAD SHEDDING (UFLS) MULTI-STAGE HARD BACKUP ---
    const uflsThreshold1 = this.nominalFreq === 60.0 ? 59.10 : 49.10;
    const uflsThreshold2 = this.nominalFreq === 60.0 ? 58.80 : 48.80;
    const uflsThreshold3 = this.nominalFreq === 60.0 ? 58.50 : 48.50;

    let hardUflsStage = 0;
    if (this.freq < uflsThreshold3) {
      hardUflsStage = 3;
    } else if (this.freq < uflsThreshold2) {
      hardUflsStage = 2;
    } else if (this.freq < uflsThreshold1) {
      hardUflsStage = 1;
    }

    if (hardUflsStage > 0) {
      const stagePcts = { 1: 0.15, 2: 0.30, 3: 0.45 };
      const minRequiredShed = this.totalLoad * stagePcts[hardUflsStage];
      if (this.mldTrippedLoad < minRequiredShed) {
        this.mldStage = hardUflsStage;
        this.mldTriggered = true;
        this.mldPercentage = stagePcts[hardUflsStage];
        this.mldTrippedLoad = minRequiredShed;

        if (hardUflsStage > this.lastMldLoggedStage) {
          this.lastMldLoggedStage = hardUflsStage;
          this.history.events.push({
            time: this.time,
            text: `⚡ HARD UFLS STAGE ${hardUflsStage} ACTIVATED @ ${this.freq.toFixed(2)} Hz: ${(stagePcts[hardUflsStage] * 100).toFixed(0)}% Load Dropped (-${minRequiredShed.toFixed(0)} MW) to arrest grid collapse!`
          });
        }
      }
    }

    // Record history
    this.history.time.push(parseFloat(this.time.toFixed(2)));
    this.history.freq.push(parseFloat(this.freq.toFixed(3)));
    this.history.rocof.push(parseFloat(rocof.toFixed(3)));
    this.history.genTotal.push(parseFloat(totalActiveGenMW.toFixed(1)));
    this.history.loadTotal.push(parseFloat(totalDampedLoadMW.toFixed(1)));
    this.history.ffrPower.push(parseFloat(this.ffrDeployed.toFixed(1)));
    this.history.regPower.push(parseFloat(this.regDeployed.toFixed(1)));
    this.history.spinPower.push(parseFloat(this.spinDeployed.toFixed(1)));
    this.history.nonSpinPower.push(parseFloat(this.nonSpinDeployed.toFixed(1)));

    if (this.history.time.length > 500) {
      this.history.time.shift();
      this.history.freq.shift();
      this.history.rocof.shift();
      this.history.genTotal.shift();
      this.history.loadTotal.shift();
      this.history.ffrPower.shift();
      this.history.regPower.shift();
      this.history.spinPower.shift();
      this.history.nonSpinPower.shift();
    }

    return {
      time: this.time,
      freq: this.freq,
      rocof: rocof,
      deltaFreq: this.deltaFreq,
      totalActiveGen: totalActiveGenMW,
      totalDampedLoad: totalDampedLoadMW,
      ffrDeployed: this.ffrDeployed,
      regDeployed: this.regDeployed,
      spinDeployed: this.spinDeployed,
      nonSpinDeployed: this.nonSpinDeployed,
      activeOutages: this.activeOutages,
      trippedPlantMW: this.trippedPlantMW,
      mldActive: this.mldTriggered,
      mldStage: this.mldStage,
      mldTrippedLoad: this.mldTrippedLoad,
      mldPercentage: this.mldPercentage
    };
  }
}

// ============================================================================
// CO-OPTIMIZED RESERVE & ENERGY MARKET CLEARING ENGINE
// Computes Linear Dispatch, Marginal Clearing Prices, and Lost Opportunity Cost
// ============================================================================

class MarketCoOptimizationEngine {
  constructor() {
    this.generators = [
      { id: "G1_Coal", name: "Coal Supercritical 1", maxMW: 600, minMW: 150, energyBid: 42, regBid: 12, spinBid: 8, maxRamp: 15, isOnline: true },
      { id: "G2_Hydro", name: "Magat Hydro Plant", maxMW: 360, minMW: 50, energyBid: 28, regBid: 6, spinBid: 4, maxRamp: 60, isOnline: true },
      { id: "G3_GasCC", name: "Combined Cycle Gas", maxMW: 500, minMW: 100, energyBid: 65, regBid: 14, spinBid: 10, maxRamp: 25, isOnline: true },
      { id: "G4_BESS", name: "Grid BESS Battery 1", maxMW: 100, minMW: 0, energyBid: 95, regBid: 5, spinBid: 3, maxRamp: 100, isOnline: true },
      { id: "G5_Diesel", name: "Fast Peaker Diesel", maxMW: 120, minMW: 0, energyBid: 140, regBid: 25, spinBid: 18, maxRamp: 40, isOnline: true }
    ];
  }

  clearMarket(energyRequirementMW = 1100, regRequirementMW = 80, spinRequirementMW = 200) {
    // Greedy heuristic / linear programming approximation for joint clearing
    let results = {
      generators: [],
      energyClearedMW: 0,
      regClearedMW: 0,
      spinClearedMW: 0,
      energyPrice: 0,
      regPrice: 0,
      spinPrice: 0,
      totalCost: 0,
      locCompensations: []
    };

    // Clone generators
    let gens = this.generators.map(g => ({
      ...g,
      clearedEnergy: 0,
      clearedReg: 0,
      clearedSpin: 0,
      remainingHeadroom: g.maxMW
    }));

    // Step 1: Meet Regulation requirement first (highest value / flexibility)
    // Sort by Regulation Bid
    gens.sort((a, b) => a.regBid - b.regBid);
    let neededReg = regRequirementMW;
    for (let g of gens) {
      if (neededReg <= 0) break;
      let alloc = Math.min(neededReg, g.remainingHeadroom * 0.4, g.maxRamp * 5);
      alloc = Math.round(alloc * 10) / 10;
      g.clearedReg = alloc;
      g.remainingHeadroom -= alloc;
      neededReg -= alloc;
      results.regPrice = Math.max(results.regPrice, g.regBid);
    }

    // Step 2: Clear Energy requirement
    gens.sort((a, b) => a.energyBid - b.energyBid);
    let neededEnergy = energyRequirementMW;
    for (let g of gens) {
      if (neededEnergy <= 0) break;
      let alloc = Math.min(neededEnergy, g.remainingHeadroom);
      alloc = Math.round(alloc * 10) / 10;
      g.clearedEnergy = alloc;
      g.remainingHeadroom -= alloc;
      neededEnergy -= alloc;
      results.energyPrice = Math.max(results.energyPrice, g.energyBid);
    }

    // Step 3: Clear Spinning Reserve requirement
    gens.sort((a, b) => a.spinBid - b.spinBid);
    let neededSpin = spinRequirementMW;
    for (let g of gens) {
      if (neededSpin <= 0) break;
      let alloc = Math.min(neededSpin, g.remainingHeadroom);
      alloc = Math.round(alloc * 10) / 10;
      g.clearedSpin = alloc;
      g.remainingHeadroom -= alloc;
      neededSpin -= alloc;
      results.spinPrice = Math.max(results.spinPrice, g.spinBid);
    }

    // Step 4: Evaluate Lost Opportunity Cost (LOC)
    // If a generator's energy bid is lower than Energy Clearing Price, but it was held back to provide spin/reg:
    gens.forEach(g => {
      let locPerMW = 0;
      if (g.energyBid < results.energyPrice) {
        locPerMW = results.energyPrice - g.energyBid;
      }
      g.locPerMW = locPerMW;
      g.totalRevenue = (g.clearedEnergy * results.energyPrice) + 
                         (g.clearedReg * Math.max(results.regPrice, g.regBid + locPerMW)) +
                         (g.clearedSpin * Math.max(results.spinPrice, g.spinBid + locPerMW));
    });

    results.generators = gens;
    results.energyClearedMW = gens.reduce((sum, g) => sum + g.clearedEnergy, 0);
    results.regClearedMW = gens.reduce((sum, g) => sum + g.clearedReg, 0);
    results.spinClearedMW = gens.reduce((sum, g) => sum + g.clearedSpin, 0);
    results.totalCost = gens.reduce((sum, g) => sum + g.totalRevenue, 0);

    return results;
  }
}

// ============================================================================
// ASPA FINANCIAL & CONTRACT SETTLEMENT CALCULATOR
// Computes Monthly Statements, Capacity Fees, Energy Dispatch & Outage Penalties
// ============================================================================

class AspaSettlementCalculator {
  static calculateMonthlySettlement(params) {
    const {
      contractType = "firm", // 'firm' or 'non-firm'
      contractedCapacityMW = 100, // MW
      capacityRate = 650, // PHP/MW-h or $/MW-h
      totalHoursInMonth = 720, // 30 days * 24h
      availabilityPercentage = 98.5, // %
      dispatchedEnergyMWh = 450, // MWh dispatched for grid events
      spotEnergyRate = 4500, // PHP/MWh or $/MWh
      deratingHours = 12, // Hours operating below nominated capacity
      unexcusedOutageHours = 10, // Forced outage hours
      penaltyMultiplier = 1.5
    } = params;

    const availableHours = (availabilityPercentage / 100) * totalHoursInMonth;
    
    // 1. Capacity Availability Payment
    let grossCapacityPayment = 0;
    if (contractType === "firm") {
      grossCapacityPayment = contractedCapacityMW * capacityRate * availableHours;
    } else {
      // Non-firm receives only 15% nominal standby reservation
      grossCapacityPayment = contractedCapacityMW * (capacityRate * 0.15) * availableHours;
    }

    // 2. Incidental Energy Generation Payment
    const energyRevenue = dispatchedEnergyMWh * spotEnergyRate;

    // 3. Outage & Performance Deductions
    let outagePenalty = 0;
    if (contractType === "firm" && unexcusedOutageHours > 0) {
      outagePenalty = unexcusedOutageHours * contractedCapacityMW * capacityRate * penaltyMultiplier;
    }

    // 4. Derating Deduction
    const deratingPenalty = deratingHours * (contractedCapacityMW * 0.20) * capacityRate;

    // Net Payable
    const netPayment = Math.max(0, grossCapacityPayment + energyRevenue - outagePenalty - deratingPenalty);

    return {
      grossCapacityPayment,
      energyRevenue,
      outagePenalty,
      deratingPenalty,
      netPayment,
      effectiveHourlyRate: netPayment / totalHoursInMonth
    };
  }
}

// Export for application
if (typeof window !== "undefined") {
  window.GridPhysicsSimulator = GridPhysicsSimulator;
  window.MarketCoOptimizationEngine = MarketCoOptimizationEngine;
  window.AspaSettlementCalculator = AspaSettlementCalculator;
}
