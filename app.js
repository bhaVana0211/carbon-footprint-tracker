// Application State
let state = {
  theme: 'dark',
  unit: 'metric', // 'metric' (km, tonnes) or 'imperial' (miles, tons)
  inputs: {
    carDistance: 12000,
    fuelType: 'petrol',
    transitDistance: 50,
    shortFlights: 2,
    longFlights: 0,
    dietProfile: 'moderate-meat',
    beefServings: 3,
    dairyServings: 10,
    foodSourcing: 'average',
    electricityUsage: 350,
    solarOffset: 0,
    heatingFuel: 'natural-gas',
    heatingUsage: 500
  },
  history: [], // Array of { id, label, date, emissions }
  selectedActions: [] // Array of action IDs currently checked in simulator
};

// Emission Factors (All base calculations in kg CO2e)
const EMISSION_FACTORS = {
  transport: {
    petrol: 0.170,      // kg CO2e per km
    diesel: 0.171,      // kg CO2e per km
    hybrid: 0.100,      // kg CO2e per km
    electric: 0.045,    // kg CO2e per km (grid charging average)
    transit: 0.040,     // kg CO2e per km (bus/train mix)
    shortFlight: 150.0, // kg CO2e per flight
    longFlight: 600.0   // kg CO2e per flight
  },
  food: {
    beefServing: 6.5,   // kg CO2e per serving
    dairyServing: 1.2,  // kg CO2e per serving
    baseOther: {
      'heavy-meat': 800.0,
      'moderate-meat': 700.0,
      'vegetarian': 500.0,
      'vegan': 450.0
    },
    sourcing: {
      imported: 0.15,   // +15%
      average: 0.0,     // 0%
      local: -0.15      // -15%
    }
  },
  energy: {
    electricity: 0.38,  // kg CO2e per kWh
    heating: {
      'natural-gas': 0.180, // kg CO2e per kWh
      'heating-oil': 0.260, // kg CO2e per kWh equivalent
      'electricity': 0.380, // kg CO2e per kWh (electric heating)
      'biomass': 0.030,     // kg CO2e per kWh
      'none': 0.0
    }
  }
};

// Conversions
const KM_TO_MILES = 0.621371;
const KG_TO_LBS = 2.20462;
const TONNES_TO_TONS = 1.10231;

// Mitigation Action Definitions
const SIMULATOR_ACTIONS = [
  {
    id: 'walk_short',
    title: 'Walk or Cycle for Short Trips',
    desc: 'Replace short car drives (under 3km) with walking or biking.',
    category: 'transport',
    baseSaving: 500, // kg CO2e
    calculate: (inputs, categoryEmissions) => {
      // Limit savings to maximum of current car emissions
      const carEmissions = inputs.carDistance * EMISSION_FACTORS.transport[inputs.fuelType];
      return Math.min(500, carEmissions);
    }
  },
  {
    id: 'carpool',
    title: 'Carpool/Rideshare Twice a Week',
    desc: 'Share commutes with colleagues or friends to cut driving distance.',
    category: 'transport',
    baseSaving: 400,
    calculate: (inputs, categoryEmissions) => {
      const carEmissions = inputs.carDistance * EMISSION_FACTORS.transport[inputs.fuelType];
      return Math.min(400, carEmissions * 0.2);
    }
  },
  {
    id: 'train_flight',
    title: 'Replace 1 Short Flight with Train',
    desc: 'Take high-speed rail instead of a domestic short flight.',
    category: 'transport',
    baseSaving: 150,
    calculate: (inputs, categoryEmissions) => {
      return inputs.shortFlights > 0 ? 150 : 0;
    }
  },
  {
    id: 'switch_ev',
    title: 'Upgrade to Electric Vehicle (EV)',
    desc: 'Switch from internal combustion engine to electric driving.',
    category: 'transport',
    baseSaving: 0,
    calculate: (inputs, categoryEmissions) => {
      if (inputs.fuelType === 'electric') return 0;
      const currentCarEmissions = inputs.carDistance * EMISSION_FACTORS.transport[inputs.fuelType];
      const evCarEmissions = inputs.carDistance * EMISSION_FACTORS.transport['electric'];
      return Math.max(0, currentCarEmissions - evCarEmissions);
    }
  },
  {
    id: 'meatless_mondays',
    title: 'Meatless Mondays',
    desc: 'Skip meat products one day per week to reduce diet emissions.',
    category: 'food',
    baseSaving: 250,
    calculate: (inputs, categoryEmissions) => {
      if (inputs.dietProfile === 'vegan') return 0;
      return Math.min(250, categoryEmissions * 0.15);
    }
  },
  {
    id: 'go_vegan',
    title: 'Adopt a Fully Vegan Diet',
    desc: 'Eliminate all animal products, maximizing dietary carbon reduction.',
    category: 'food',
    baseSaving: 0,
    calculate: (inputs, categoryEmissions) => {
      if (inputs.dietProfile === 'vegan') return 0;
      
      // Calculate hypothetical vegan diet with 0 beef and 0 dairy
      const veganBase = EMISSION_FACTORS.food.baseOther['vegan'];
      const sourcingFactor = 1 + EMISSION_FACTORS.food.sourcing[inputs.foodSourcing];
      const veganTotal = veganBase * sourcingFactor;
      
      return Math.max(0, categoryEmissions - veganTotal);
    }
  },
  {
    id: 'eat_local',
    title: 'Source Food Locally & Seasonally',
    desc: 'Reduce transport food miles by buying regional seasonal food.',
    category: 'food',
    baseSaving: 0,
    calculate: (inputs, categoryEmissions) => {
      if (inputs.foodSourcing === 'local') return 0;
      // Saves the difference of moving from current sourcing to local sourcing
      const currentFactor = EMISSION_FACTORS.food.sourcing[inputs.foodSourcing];
      const localFactor = EMISSION_FACTORS.food.sourcing['local'];
      return categoryEmissions * (currentFactor - localFactor) / (1 + currentFactor);
    }
  },
  {
    id: 'green_power',
    title: 'Switch to 100% Renewable Electricity',
    desc: 'Change your utility contract to guaranteed green power.',
    category: 'energy',
    baseSaving: 0,
    calculate: (inputs, categoryEmissions) => {
      const annualElectricity = inputs.electricityUsage * 12;
      const netKwh = annualElectricity * (1 - inputs.solarOffset / 100);
      return netKwh * EMISSION_FACTORS.energy.electricity;
    }
  },
  {
    id: 'lower_thermostat',
    title: 'Lower Thermostat by 2°C',
    desc: 'Slightly reduce heating temperature during winter to save fuel.',
    category: 'energy',
    baseSaving: 0,
    calculate: (inputs, categoryEmissions) => {
      if (inputs.heatingFuel === 'none') return 0;
      const heatingEmissions = inputs.heatingUsage * 12 * EMISSION_FACTORS.energy.heating[inputs.heatingFuel];
      return heatingEmissions * 0.12; // ~12% savings from a 2 degree drop
    }
  },
  {
    id: 'install_leds',
    title: 'Upgrade All Bulbs to LED',
    desc: 'Install high-efficiency lighting throughout the household.',
    category: 'energy',
    baseSaving: 120,
    calculate: (inputs, categoryEmissions) => {
      const electricityEmissions = (inputs.electricityUsage * 12 * (1 - inputs.solarOffset / 100)) * EMISSION_FACTORS.energy.electricity;
      return Math.min(120, electricityEmissions * 0.08); // LED saves ~8% of electricity
    }
  },
  {
    id: 'install_solar',
    title: 'Install Home Solar Panels',
    desc: 'Generate your own solar electricity to offset usage by 50% extra.',
    category: 'energy',
    baseSaving: 0,
    calculate: (inputs, categoryEmissions) => {
      if (inputs.solarOffset >= 90) return 0;
      const currentOffsetFraction = inputs.solarOffset / 100;
      const targetOffsetFraction = Math.min(1.0, currentOffsetFraction + 0.5); // Add 50% offset
      
      const annualElectricity = inputs.electricityUsage * 12;
      const currentEmissions = annualElectricity * (1 - currentOffsetFraction) * EMISSION_FACTORS.energy.electricity;
      const targetEmissions = annualElectricity * (1 - targetOffsetFraction) * EMISSION_FACTORS.energy.electricity;
      
      return Math.max(0, currentEmissions - targetEmissions);
    }
  }
];

// Global Chart variables
let breakdownChart = null;
let historyChart = null;

// Initialize Web App
if (typeof document !== 'undefined') {
  document.addEventListener("DOMContentLoaded", () => {
    loadData();
    setupNavigation();
    setupTheme();
    setupUnitSystem();
    setupFormControls();
    calculateAll();
    renderHistoryTable();
    initBreakdownChart();
    initHistoryChart();
    renderSimulatorActions();
    updateBadge();
  });
}

// Load state from localStorage
function loadData() {
  const cached = localStorage.getItem('ecofootprint_state');
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      // Merge keys to ensure compatibility
      state = { ...state, ...parsed };
      // Sync unit toggle element
      syncUnitDisplayElements();
    } catch (e) {
      console.error("Error reading localStorage", e);
    }
  } else {
    // Generate some default history entries so the history chart isn't empty
    state.history = [
      { id: '1', label: '2024 Initial Baseline', date: '2024-01-15', emissions: 8.5 },
      { id: '2', label: 'Switch to Hybrid Car', date: '2024-09-10', emissions: 6.8 },
      { id: '3', label: 'Installed Smart Thermostat', date: '2025-02-28', emissions: 6.2 }
    ];
    saveStateToLocalStorage();
  }
}

// Save state to localStorage
function saveStateToLocalStorage() {
  localStorage.setItem('ecofootprint_state', JSON.stringify(state));
}

// Navigation System
function setupNavigation() {
  const navItems = document.querySelectorAll(".nav-item");
  const viewSections = document.querySelectorAll(".view-section");
  const viewMap = {
    'nav-dash': 'view-dashboard',
    'nav-calc': 'view-calculator',
    'nav-sim': 'view-simulator',
    'nav-hist': 'view-history'
  };

  // Quick link button helper
  const quickSimBtn = document.getElementById("btn-quick-sim");
  if (quickSimBtn) {
    quickSimBtn.addEventListener("click", (e) => {
      e.preventDefault();
      switchView('nav-sim');
    });
  }

  navItems.forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      switchView(item.id);
    });
  });

  // Handle hash changes or reloads
  if (window.location.hash) {
    const hashId = window.location.hash.substring(1);
    const matchedNavItem = Array.from(navItems).find(item => item.getAttribute('href') === `#${hashId}`);
    if (matchedNavItem) {
      switchView(matchedNavItem.id);
    }
  }

  function switchView(navId) {
    navItems.forEach(n => n.classList.remove('active'));
    viewSections.forEach(v => v.classList.remove('active-view'));

    const navItemElement = document.getElementById(navId);
    if (navItemElement) {
      navItemElement.classList.add('active');
    }

    const sectionId = viewMap[navId];
    const sectionElement = document.getElementById(sectionId);
    if (sectionElement) {
      sectionElement.classList.add('active-view');
      window.location.hash = navItemElement.getAttribute('href');
      
      // Update page header title dynamically
      const pageTitle = document.getElementById("page-title");
      if (navId === 'nav-dash') pageTitle.textContent = "Dashboard Summary";
      else if (navId === 'nav-calc') pageTitle.textContent = "Emissions Calculator";
      else if (navId === 'nav-sim') pageTitle.textContent = "Carbon Action Simulator";
      else if (navId === 'nav-hist') pageTitle.textContent = "Emissions History Log";
    }
  }
  
  // Set date in header
  const headerDateStr = document.getElementById("header-date");
  if (headerDateStr) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    headerDateStr.textContent = new Date().toLocaleDateString('en-US', options);
  }
}

// Light / Dark Theme setup
function setupTheme() {
  const htmlEl = document.documentElement;
  const themeBtn = document.getElementById("btn-theme-toggle");
  
  // Set theme from state
  htmlEl.setAttribute('data-theme', state.theme);
  updateThemeButtonIcon();

  themeBtn.addEventListener("click", () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    htmlEl.setAttribute('data-theme', state.theme);
    updateThemeButtonIcon();
    saveStateToLocalStorage();
    
    // Update chart layouts for new theme colors
    updateChartThemes();
  });

  function updateThemeButtonIcon() {
    const icon = themeBtn.querySelector("i");
    if (state.theme === 'dark') {
      icon.className = "fa-solid fa-sun text-warning";
    } else {
      icon.className = "fa-solid fa-moon text-primary";
    }
  }
}

// Unit conversion toggle setup
function setupUnitSystem() {
  const unitBtn = document.getElementById("btn-unit-toggle");
  
  syncUnitDisplayElements();

  unitBtn.addEventListener("click", () => {
    state.unit = state.unit === 'metric' ? 'imperial' : 'metric';
    syncUnitDisplayElements();
    saveStateToLocalStorage();
    
    // Recalculate and refresh views
    calculateAll();
    renderSimulatorActions();
    updateSimulatorVisuals();
    renderHistoryTable();
    updateCharts();
  });
}

function syncUnitDisplayElements() {
  const btnText = document.getElementById("lbl-unit-toggle");
  const distanceUnits = document.querySelectorAll(".unit-distance");
  
  if (state.unit === 'metric') {
    if (btnText) btnText.textContent = "Metric (kg/km)";
    distanceUnits.forEach(u => u.textContent = "km");
    document.getElementById("lbl-total-unit").textContent = "tonnes CO₂e";
  } else {
    if (btnText) btnText.textContent = "Imperial (lbs/miles)";
    distanceUnits.forEach(u => u.textContent = "miles");
    document.getElementById("lbl-total-unit").textContent = "tons CO₂e";
  }
}

// Sync inputs with form state and configure listeners
function setupFormControls() {
  // Transport Sliders & Inputs
  const carDistSlider = document.getElementById("slide-car-distance");
  const fuelSelect = document.getElementById("select-fuel-type");
  const transitSlider = document.getElementById("slide-transit-distance");
  const shortFlightsInput = document.getElementById("num-short-flights");
  const longFlightsInput = document.getElementById("num-long-flights");

  // Food Sliders & Radios
  const dietProfileRadios = document.getElementsByName("diet-profile");
  const beefSlider = document.getElementById("slide-beef-servings");
  const dairySlider = document.getElementById("slide-dairy-servings");
  const foodSourcingSelect = document.getElementById("select-food-sourcing");

  // Energy Sliders & Selects
  const electricitySlider = document.getElementById("slide-electricity-usage");
  const solarSlider = document.getElementById("slide-solar-offset");
  const heatingFuelSelect = document.getElementById("select-heating-fuel");
  const heatingSlider = document.getElementById("slide-heating-usage");

  // Apply state to inputs
  carDistSlider.value = state.inputs.carDistance;
  fuelSelect.value = state.inputs.fuelType;
  transitSlider.value = state.inputs.transitDistance;
  shortFlightsInput.value = state.inputs.shortFlights;
  longFlightsInput.value = state.inputs.longFlights;
  
  // Set Checked Radio
  dietProfileRadios.forEach(radio => {
    if (radio.value === state.inputs.dietProfile) {
      radio.checked = true;
    }
  });
  
  beefSlider.value = state.inputs.beefServings;
  dairySlider.value = state.inputs.dairyServings;
  foodSourcingSelect.value = state.inputs.foodSourcing;
  
  electricitySlider.value = state.inputs.electricityUsage;
  solarSlider.value = state.inputs.solarOffset;
  heatingFuelSelect.value = state.inputs.heatingFuel;
  heatingSlider.value = state.inputs.heatingUsage;

  // Sync display text values
  syncTextDisplays();

  // Slider Change Event Listeners
  const bindSliderDisplay = (slider, displayElId, suffix = "", convertDistance = false) => {
    const updateDisplay = () => {
      const valEl = document.getElementById(displayElId);
      if (!valEl) return;
      
      let val = parseFloat(slider.value);
      if (convertDistance && state.unit === 'imperial') {
        val = Math.round(val * KM_TO_MILES);
      }
      valEl.textContent = val.toLocaleString();
    };
    
    slider.addEventListener("input", () => {
      updateDisplay();
      updateInputState(slider.id, slider.value);
      calculateAll();
    });
    
    // Initial sync
    updateDisplay();
  };

  bindSliderDisplay(carDistSlider, "val-car-distance", "", true);
  bindSliderDisplay(transitSlider, "val-transit-distance", "", true);
  bindSliderDisplay(electricitySlider, "val-electricity-usage");
  bindSliderDisplay(solarSlider, "val-solar-offset");
  bindSliderDisplay(heatingSlider, "val-heating-usage");
  bindSliderDisplay(beefSlider, "val-beef-servings");
  bindSliderDisplay(dairySlider, "val-dairy-servings");

  // Input events
  const handleFlightInput = (inputEl, stateKey, displayElId) => {
    let valStr = inputEl.value;
    if (valStr === "") return; // let them clear and type, will clamp on blur
    
    let val = parseInt(valStr);
    const limits = {
      shortFlights: { min: 0, max: 100 },
      longFlights: { min: 0, max: 50 }
    };
    const { min, max } = limits[stateKey];
    
    if (!isNaN(val)) {
      if (val < min) val = min;
      if (val > max) val = max;
      inputEl.value = val;
    }
    
    document.getElementById(displayElId).textContent = inputEl.value;
    updateInputState(stateKey, inputEl.value);
    calculateAll();
  };

  const handleFlightBlur = (inputEl, stateKey, displayElId) => {
    if (inputEl.value === "") {
      inputEl.value = 0;
      document.getElementById(displayElId).textContent = "0";
      updateInputState(stateKey, 0);
      calculateAll();
    }
  };

  shortFlightsInput.addEventListener("input", () => {
    handleFlightInput(shortFlightsInput, "shortFlights", "val-short-flights");
  });

  shortFlightsInput.addEventListener("blur", () => {
    handleFlightBlur(shortFlightsInput, "shortFlights", "val-short-flights");
  });

  longFlightsInput.addEventListener("input", () => {
    handleFlightInput(longFlightsInput, "longFlights", "val-long-flights");
  });

  longFlightsInput.addEventListener("blur", () => {
    handleFlightBlur(longFlightsInput, "longFlights", "val-long-flights");
  });

  fuelSelect.addEventListener("change", () => {
    updateInputState("fuelType", fuelSelect.value);
    calculateAll();
  });

  foodSourcingSelect.addEventListener("change", () => {
    updateInputState("foodSourcing", foodSourcingSelect.value);
    calculateAll();
  });

  heatingFuelSelect.addEventListener("change", () => {
    updateInputState("heatingFuel", heatingFuelSelect.value);
    calculateAll();
  });

  // Diet Profile Radios Event
  dietProfileRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        updateInputState("dietProfile", radio.value);
        
        // Adjust beef and dairy sliders to match typical profile defaults
        if (radio.value === 'heavy-meat') {
          beefSlider.value = 6;
          dairySlider.value = 15;
        } else if (radio.value === 'moderate-meat') {
          beefSlider.value = 3;
          dairySlider.value = 10;
        } else if (radio.value === 'vegetarian') {
          beefSlider.value = 0;
          dairySlider.value = 12;
        } else if (radio.value === 'vegan') {
          beefSlider.value = 0;
          dairySlider.value = 0;
        }
        
        // Sync new slider states
        updateInputState("beefServings", beefSlider.value);
        updateInputState("dairyServings", dairySlider.value);
        
        // Trigger displays
        triggerElementInput(beefSlider);
        triggerElementInput(dairySlider);
        
        calculateAll();
      }
    });
  });

  // Helper to trigger events
  function triggerElementInput(el) {
    const event = new Event('input', { bubbles: true });
    el.dispatchEvent(event);
  }

  // Reset defaults button
  document.getElementById("btn-reset-form").addEventListener("click", () => {
    state.inputs = {
      carDistance: 12000,
      fuelType: 'petrol',
      transitDistance: 50,
      shortFlights: 2,
      longFlights: 0,
      dietProfile: 'moderate-meat',
      beefServings: 3,
      dairyServings: 10,
      foodSourcing: 'average',
      electricityUsage: 350,
      solarOffset: 0,
      heatingFuel: 'natural-gas',
      heatingUsage: 500
    };
    
    // Apply states back to UI
    carDistSlider.value = state.inputs.carDistance;
    fuelSelect.value = state.inputs.fuelType;
    transitSlider.value = state.inputs.transitDistance;
    shortFlightsInput.value = state.inputs.shortFlights;
    longFlightsInput.value = state.inputs.longFlights;
    
    dietProfileRadios.forEach(r => {
      if (r.value === state.inputs.dietProfile) r.checked = true;
    });
    
    beefSlider.value = state.inputs.beefServings;
    dairySlider.value = state.inputs.dairyServings;
    foodSourcingSelect.value = state.inputs.foodSourcing;
    
    electricitySlider.value = state.inputs.electricityUsage;
    solarSlider.value = state.inputs.solarOffset;
    heatingFuelSelect.value = state.inputs.heatingFuel;
    heatingSlider.value = state.inputs.heatingUsage;
    
    // Force inputs triggers
    triggerElementInput(carDistSlider);
    triggerElementInput(transitSlider);
    triggerElementInput(beefSlider);
    triggerElementInput(dairySlider);
    triggerElementInput(electricitySlider);
    triggerElementInput(solarSlider);
    triggerElementInput(heatingSlider);
    
    document.getElementById("val-short-flights").textContent = state.inputs.shortFlights;
    document.getElementById("val-long-flights").textContent = state.inputs.longFlights;
    
    calculateAll();
    saveStateToLocalStorage();
  });

  // Save current form inputs baseline
  document.getElementById("btn-save-inputs").addEventListener("click", () => {
    saveStateToLocalStorage();
    
    // Navigate back to Dashboard Summary view
    document.getElementById("nav-dash").click();
  });

  // Save Log form submission
  document.getElementById("save-log-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const labelInput = document.getElementById("input-log-name");
    const label = labelInput.value.trim();
    if (!label) return;

    // Calculate total emissions in tonnes
    const calculations = calculateCurrentEmissions();
    const totalTonnes = calculations.total / 1000;

    const newLog = {
      id: Date.now().toString(),
      label: label,
      date: new Date().toISOString().split('T')[0],
      emissions: totalTonnes
    };

    state.history.push(newLog);
    
    // Sort logs by date or creation time
    state.history.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    saveStateToLocalStorage();
    labelInput.value = "";
    
    renderHistoryTable();
    updateHistoryChart();
  });

  // Clear History
  document.getElementById("btn-clear-history").addEventListener("click", () => {
    if (confirm("Are you sure you want to delete all saved history items? This cannot be undone.")) {
      state.history = [];
      saveStateToLocalStorage();
      renderHistoryTable();
      updateHistoryChart();
    }
  });
}

function updateInputState(id, value) {
  // Parse elements correctly
  const floatVal = parseFloat(value);
  const key = id.replace('slide-', '').replace('select-', '').replace('num-', '').replace('input-', '');
  
  // Mapping key formats
  const stateMapping = {
    'car-distance': 'carDistance',
    'fuel-type': 'fuelType',
    'transit-distance': 'transitDistance',
    'short-flights': 'shortFlights',
    'long-flights': 'longFlights',
    'diet-profile': 'dietProfile',
    'beef-servings': 'beefServings',
    'dairy-servings': 'dairyServings',
    'food-sourcing': 'foodSourcing',
    'electricity-usage': 'electricityUsage',
    'solar-offset': 'solarOffset',
    'heating-fuel': 'heatingFuel',
    'heating-usage': 'heatingUsage'
  };

  const stateKey = stateMapping[key] || key;
  let finalVal = isNaN(floatVal) ? value : floatVal;

  if (!isNaN(floatVal)) {
    const limits = {
      carDistance: { min: 0, max: 60000 },
      transitDistance: { min: 0, max: 500 },
      shortFlights: { min: 0, max: 100 },
      longFlights: { min: 0, max: 50 },
      beefServings: { min: 0, max: 14 },
      dairyServings: { min: 0, max: 28 },
      electricityUsage: { min: 0, max: 2000 },
      solarOffset: { min: 0, max: 100 },
      heatingUsage: { min: 0, max: 3000 }
    };
    if (limits[stateKey]) {
      const { min, max } = limits[stateKey];
      finalVal = Math.max(min, Math.min(max, floatVal));
    }
  }

  state.inputs[stateKey] = finalVal;
}

function syncTextDisplays() {
  document.getElementById("val-short-flights").textContent = state.inputs.shortFlights;
  document.getElementById("val-long-flights").textContent = state.inputs.longFlights;
}

// Calculations Engine
function calculateCurrentEmissions() {
  const inp = state.inputs;
  
  // 1. Transport Emissions
  const fuelFactor = EMISSION_FACTORS.transport[inp.fuelType];
  const carCO2 = inp.carDistance * fuelFactor;
  const transitCO2 = inp.transitDistance * 52 * EMISSION_FACTORS.transport.transit;
  const shortFlightCO2 = inp.shortFlights * EMISSION_FACTORS.transport.shortFlight;
  const longFlightCO2 = inp.longFlights * EMISSION_FACTORS.transport.longFlight;
  const transportTotal = carCO2 + transitCO2 + shortFlightCO2 + longFlightCO2;

  // 2. Food & Diet Emissions
  const beefCO2 = inp.beefServings * 52 * EMISSION_FACTORS.food.beefServing;
  const dairyCO2 = inp.dairyServings * 52 * EMISSION_FACTORS.food.dairyServing;
  const baseOther = EMISSION_FACTORS.food.baseOther[inp.dietProfile] || 700;
  
  const rawFoodTotal = baseOther + beefCO2 + dairyCO2;
  const sourcingMultiplier = 1 + EMISSION_FACTORS.food.sourcing[inp.foodSourcing];
  const foodTotal = rawFoodTotal * sourcingMultiplier;

  // 3. Home Energy Emissions
  const electricityAnnual = inp.electricityUsage * 12;
  const electricityNet = electricityAnnual * (1 - inp.solarOffset / 100);
  const electricityCO2 = electricityNet * EMISSION_FACTORS.energy.electricity;

  const heatingFuelFactor = EMISSION_FACTORS.energy.heating[inp.heatingFuel] || 0;
  // If heating is electric, solar panels offset electricity heating too
  let heatingFactorAdjusted = heatingFuelFactor;
  if (inp.heatingFuel === 'electricity') {
    heatingFactorAdjusted = heatingFuelFactor * (1 - inp.solarOffset / 100);
  }
  const heatingCO2 = inp.heatingUsage * 12 * heatingFactorAdjusted;
  
  const energyTotal = electricityCO2 + heatingCO2;

  const grandTotal = transportTotal + foodTotal + energyTotal;

  return {
    transport: transportTotal,
    food: foodTotal,
    energy: energyTotal,
    total: grandTotal
  };
}

// Runs calculations, updates Dashboard UI metrics, charts & simulator parameters
function calculateAll() {
  const result = calculateCurrentEmissions();
  
  // Convert based on selected units
  let displayTotal = result.total / 1000; // metric tonnes
  let displayTransport = result.transport / 1000;
  let displayFood = result.food / 1000;
  let displayEnergy = result.energy / 1000;
  
  if (state.unit === 'imperial') {
    displayTotal *= TONNES_TO_TONS;
    displayTransport *= TONNES_TO_TONS;
    displayFood *= TONNES_TO_TONS;
    displayEnergy *= TONNES_TO_TONS;
  }

  // Update Stats Cards
  document.getElementById("txt-total-emissions").textContent = displayTotal.toFixed(2);
  document.getElementById("txt-compare-you").textContent = displayTotal.toFixed(1);
  
  // Compare Progress Bar sizing
  const youBar = document.getElementById("bar-compare-you");
  const youProgressPercent = Math.min(100, (displayTotal / (state.unit === 'imperial' ? 16 * TONNES_TO_TONS : 16)) * 100);
  youBar.style.width = `${youProgressPercent}%`;

  // Equivalencies: seedlings grown for 10 years offsets approx 22 kg CO2 per seedling per year (so 0.022 tonnes CO2/year)
  const treeMultiplier = state.unit === 'metric' ? 45.45 : (45.45 / TONNES_TO_TONS);
  const seedlingsOffset = Math.round(displayTotal * treeMultiplier);
  document.getElementById("txt-equivalent-trees").textContent = seedlingsOffset.toLocaleString();

  // Dynamic status rating and style
  const ratingEl = document.getElementById("emissions-rating");
  const targetThreshold = state.unit === 'imperial' ? 2 * TONNES_TO_TONS : 2.0;
  const globalAvgThreshold = state.unit === 'imperial' ? 4.8 * TONNES_TO_TONS : 4.8;
  
  ratingEl.className = "trend-indicator";
  if (displayTotal <= targetThreshold) {
    ratingEl.classList.add("low");
    ratingEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Climate Hero status (&lt; 2.0t target)`;
  } else if (displayTotal <= globalAvgThreshold) {
    ratingEl.classList.add("medium");
    ratingEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Moderate footprint (below global average)`;
  } else {
    ratingEl.classList.add("high");
    ratingEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> High footprint (above average)`;
  }

  // Dashboard splits bar sizes
  const maxCategoryEmissions = Math.max(displayTransport, displayFood, displayEnergy, 0.1);
  
  document.getElementById("txt-impact-transport").textContent = displayTransport.toFixed(1);
  document.getElementById("txt-impact-food").textContent = displayFood.toFixed(1);
  document.getElementById("txt-impact-energy").textContent = displayEnergy.toFixed(1);

  document.getElementById("bar-impact-transport").style.width = `${(displayTransport / maxCategoryEmissions) * 100}%`;
  document.getElementById("bar-impact-food").style.width = `${(displayFood / maxCategoryEmissions) * 100}%`;
  document.getElementById("bar-impact-energy").style.width = `${(displayEnergy / maxCategoryEmissions) * 100}%`;

  // Update Breakdown Chart if initialized
  if (breakdownChart) {
    breakdownChart.data.datasets[0].data = [
      result.transport.toFixed(0),
      result.food.toFixed(0),
      result.energy.toFixed(0)
    ];
    breakdownChart.update();
  }

  // Update Simulator inputs values
  updateSimulatorVisuals();
  updateBadge();
}

// Badge level generator
function updateBadge() {
  const result = calculateCurrentEmissions();
  const tonnes = result.total / 1000;
  
  const titleEl = document.getElementById("badge-title");
  const descEl = document.getElementById("badge-desc");
  const iconEl = document.querySelector(".sidebar-footer i");

  iconEl.className = "fa-solid";

  if (tonnes > 12) {
    titleEl.textContent = "Carbon Heavyweight";
    descEl.textContent = "Carbon Footprint > 12t";
    iconEl.classList.add("fa-cloud-meatball", "text-error");
  } else if (tonnes > 7) {
    titleEl.textContent = "Eco Novice";
    descEl.textContent = "Carbon Footprint > 7t";
    iconEl.classList.add("fa-award", "text-warning");
  } else if (tonnes > 3) {
    titleEl.textContent = "Green Practitioner";
    descEl.textContent = "Carbon Footprint > 3t";
    iconEl.classList.add("fa-medal", "text-primary");
  } else {
    titleEl.textContent = "Eco Guardian";
    descEl.textContent = "Carbon Footprint ≤ 3t";
    iconEl.classList.add("fa-shield-halved", "text-success");
  }
}

// Chart.js Visualizations Setup
function initBreakdownChart() {
  const ctx = document.getElementById('chart-breakdown').getContext('2d');
  const result = calculateCurrentEmissions();
  
  const themeColors = getThemeColors();

  breakdownChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Transport', 'Food & Diet', 'Home Energy'],
      datasets: [{
        data: [result.transport.toFixed(0), result.food.toFixed(0), result.energy.toFixed(0)],
        backgroundColor: [
          '#3b82f6', // transport blue
          '#f59e0b', // food yellow
          '#10b981'  // energy green
        ],
        borderWidth: state.theme === 'dark' ? 2 : 1,
        borderColor: themeColors.borderColor
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: themeColors.textColor,
            font: {
              family: 'Inter',
              size: 12,
              weight: '500'
            },
            padding: 20
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              let val = context.raw;
              let suffix = "kg CO₂e";
              if (state.unit === 'imperial') {
                val = Math.round(val * KG_TO_LBS);
                suffix = "lbs CO₂e";
              }
              return ` ${context.label}: ${val.toLocaleString()} ${suffix}`;
            }
          }
        }
      },
      cutout: '65%'
    }
  });
}

function initHistoryChart() {
  const ctx = document.getElementById('chart-history').getContext('2d');
  const themeColors = getThemeColors();

  // Map state history to chart coordinates
  const labels = state.history.map(item => item.label);
  const data = state.history.map(item => {
    let val = item.emissions; // tonnes
    if (state.unit === 'imperial') {
      val *= TONNES_TO_TONS;
    }
    return val.toFixed(2);
  });

  historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: `Emissions (${state.unit === 'metric' ? 'tonnes' : 'tons'} CO₂e)`,
        data: data,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#10b981',
        pointBorderColor: themeColors.borderColor,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          grid: {
            color: themeColors.gridColor
          },
          ticks: {
            color: themeColors.textColor,
            font: { family: 'Inter' }
          }
        },
        y: {
          grid: {
            color: themeColors.gridColor
          },
          ticks: {
            color: themeColors.textColor,
            font: { family: 'Inter' }
          },
          beginAtZero: true
        }
      }
    }
  });
}

function updateCharts() {
  if (breakdownChart) {
    const result = calculateCurrentEmissions();
    breakdownChart.data.datasets[0].data = [
      result.transport.toFixed(0),
      result.food.toFixed(0),
      result.energy.toFixed(0)
    ];
    breakdownChart.update();
  }

  updateHistoryChart();
}

function updateHistoryChart() {
  if (!historyChart) return;
  
  const labels = state.history.map(item => item.label);
  const data = state.history.map(item => {
    let val = item.emissions;
    if (state.unit === 'imperial') {
      val *= TONNES_TO_TONS;
    }
    return val;
  });

  const themeColors = getThemeColors();

  historyChart.data.labels = labels;
  historyChart.data.datasets[0].data = data;
  historyChart.data.datasets[0].label = `Emissions (${state.unit === 'metric' ? 'tonnes' : 'tons'} CO₂e)`;
  historyChart.update();
}

// Adjust colors for light/dark theme toggles
function updateChartThemes() {
  const themeColors = getThemeColors();
  
  if (breakdownChart) {
    breakdownChart.options.plugins.legend.labels.color = themeColors.textColor;
    breakdownChart.data.datasets[0].borderColor = themeColors.borderColor;
    breakdownChart.update();
  }
  
  if (historyChart) {
    historyChart.options.scales.x.grid.color = themeColors.gridColor;
    historyChart.options.scales.x.ticks.color = themeColors.textColor;
    historyChart.options.scales.y.grid.color = themeColors.gridColor;
    historyChart.options.scales.y.ticks.color = themeColors.textColor;
    historyChart.data.datasets[0].pointBorderColor = themeColors.borderColor;
    historyChart.update();
  }
}

function getThemeColors() {
  if (state.theme === 'dark') {
    return {
      textColor: '#94a3b8',
      borderColor: '#1e293b',
      gridColor: 'rgba(255, 255, 255, 0.05)'
    };
  } else {
    return {
      textColor: '#64748b',
      borderColor: '#ffffff',
      gridColor: 'rgba(0, 0, 0, 0.05)'
    };
  }
}

// Render Simulator Actions Checklist
function renderSimulatorActions() {
  const container = document.getElementById("action-list-container");
  if (!container) return;
  
  // Clear and filter based on tabs
  const activeTab = document.querySelector(".sim-tab.active");
  const activeCat = activeTab ? activeTab.getAttribute("data-sim-cat") : "all";

  // Pre-calculate category emissions to feed calculations
  const result = calculateCurrentEmissions();
  
  container.innerHTML = "";

  const filteredActions = SIMULATOR_ACTIONS.filter(act => activeCat === "all" || act.category === activeCat);

  if (filteredActions.length === 0) {
    container.innerHTML = `<p class="text-center text-muted py-4">No actions available in this category.</p>`;
    return;
  }

  filteredActions.forEach(action => {
    // Determine dynamic saving
    const catEmissions = result[action.category];
    const kgSaving = action.calculate(state.inputs, catEmissions);
    
    // Ignore actions that have zero savings based on inputs
    if (kgSaving <= 0) return;

    let displaySavingText = "";
    if (state.unit === 'metric') {
      displaySavingText = `${kgSaving.toFixed(0)} kg CO₂e / yr`;
    } else {
      displaySavingText = `${Math.round(kgSaving * KG_TO_LBS).toLocaleString()} lbs CO₂e / yr`;
    }

    const isChecked = state.selectedActions.includes(action.id);

    const actionCard = document.createElement("div");
    actionCard.className = `action-card ${isChecked ? 'checked-action' : ''}`;
    actionCard.setAttribute("data-action-id", action.id);
    
    // Icon configurations
    let iconClass = "fa-car transport-bg text-white";
    if (action.category === 'food') iconClass = "fa-utensils food-bg text-white";
    if (action.category === 'energy') iconClass = "fa-bolt energy-bg text-white";

    actionCard.innerHTML = `
      <input type="checkbox" id="chk-${action.id}" class="action-checkbox" ${isChecked ? 'checked' : ''} aria-labelledby="title-${action.id}" aria-describedby="desc-${action.id}">
      <div class="action-badge ${iconClass.split(' ')[1]}" aria-hidden="true">
        <i class="fa-solid ${iconClass.split(' ')[0]}"></i>
      </div>
      <div class="action-details">
        <div class="action-title" id="title-${action.id}">${action.title}</div>
        <div class="action-desc text-muted text-sm" id="desc-${action.id}">${action.desc}</div>
      </div>
      <div class="action-impact">${displaySavingText}</div>
    `;

    // Click logic
    actionCard.addEventListener("click", (e) => {
      const checkbox = actionCard.querySelector(".action-checkbox");
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
      }
      
      toggleSimAction(action.id, checkbox.checked);
      
      if (checkbox.checked) {
        actionCard.classList.add("checked-action");
      } else {
        actionCard.classList.remove("checked-action");
      }
    });

    container.appendChild(actionCard);
  });

  // Simulator tabs listener hook
  const simTabs = document.querySelectorAll(".sim-tab");
  simTabs.forEach(tab => {
    // Avoid binding redundant listener
    if (!tab.dataset.hasListener) {
      tab.addEventListener("click", () => {
        simTabs.forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        renderSimulatorActions();
      });
      tab.dataset.hasListener = "true";
    }
  });
}

function toggleSimAction(actionId, isChecked) {
  if (isChecked) {
    if (!state.selectedActions.includes(actionId)) {
      state.selectedActions.push(actionId);
    }
  } else {
    state.selectedActions = state.selectedActions.filter(id => id !== actionId);
  }
  
  saveStateToLocalStorage();
  updateSimulatorVisuals();
}

function updateSimulatorVisuals() {
  const result = calculateCurrentEmissions();
  const currentKg = result.total;

  let savedKg = 0;
  state.selectedActions.forEach(actionId => {
    const actionDef = SIMULATOR_ACTIONS.find(a => a.id === actionId);
    if (actionDef) {
      const catEmissions = result[actionDef.category];
      const saving = actionDef.calculate(state.inputs, catEmissions);
      savedKg += saving;
    }
  });

  const projectedKg = Math.max(0, currentKg - savedKg);
  const reductionPercentage = currentKg > 0 ? Math.round((savedKg / currentKg) * 100) : 0;

  // Convert to target units
  let displayCurrent = currentKg / 1000;
  let displaySaved = savedKg / 1000;
  let displayProjected = projectedKg / 1000;

  if (state.unit === 'imperial') {
    displayCurrent *= TONNES_TO_TONS;
    displaySaved *= TONNES_TO_TONS;
    displayProjected *= TONNES_TO_TONS;
  }

  const currentValEl = document.getElementById("sim-current-val");
  const savingsValEl = document.getElementById("sim-savings-val");
  const projectedValEl = document.getElementById("sim-projected-val");
  const pctEl = document.getElementById("txt-sim-percentage");

  if (currentValEl) currentValEl.textContent = displayCurrent.toFixed(2);
  if (savingsValEl) savingsValEl.textContent = displaySaved.toFixed(2);
  if (projectedValEl) projectedValEl.textContent = displayProjected.toFixed(2);
  if (pctEl) pctEl.textContent = `${reductionPercentage}% Reduced`;

  // Update large simulator bar overlay
  const projectedBar = document.getElementById("bar-sim-projected");
  const currentBar = document.getElementById("bar-sim-current");
  
  if (projectedBar && currentBar) {
    // Current bar stays at full (100% of current) or scales to max
    // Let's make the projected width reflect the ratio of projected to current
    const ratio = currentKg > 0 ? (projectedKg / currentKg) * 100 : 100;
    projectedBar.style.width = `${ratio}%`;
  }
}

// Render History Log Entries in Table
function renderHistoryTable() {
  const tbody = document.getElementById("table-body-logs");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (state.history.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center text-muted py-4">No records saved yet. Adjust calculations and save!</td>
      </tr>
    `;
    return;
  }

  state.history.forEach(log => {
    let displayEmissions = log.emissions; // tonnes base
    let unitLabel = "t";
    
    if (state.unit === 'imperial') {
      displayEmissions *= TONNES_TO_TONS;
      unitLabel = "tons";
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="font-semibold">${log.label}</td>
      <td>${formatDate(log.date)}</td>
      <td><span class="font-bold text-success">${displayEmissions.toFixed(2)}</span> ${unitLabel} CO₂e</td>
      <td>
        <button class="btn-delete-row" data-log-id="${log.id}" title="Delete Log">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </td>
    `;

    // Row deletion hook
    row.querySelector(".btn-delete-row").addEventListener("click", (e) => {
      e.stopPropagation();
      const logId = e.currentTarget.getAttribute("data-log-id");
      deleteHistoryRow(logId);
    });

    tbody.appendChild(row);
  });
}

function deleteHistoryRow(id) {
  state.history = state.history.filter(log => log.id !== id);
  saveStateToLocalStorage();
  renderHistoryTable();
  updateHistoryChart();
}

function formatDate(dateString) {
  const parts = dateString.split('-');
  if (parts.length !== 3) return dateString;
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Form Tabs logic
if (typeof document !== 'undefined') {
  const tabs = document.querySelectorAll(".calc-tab");
  const panes = document.querySelectorAll(".tab-pane");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      panes.forEach(p => p.classList.remove("active"));

      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      const targetPaneId = `pane-${tab.getAttribute("data-tab")}`;
      document.getElementById(targetPaneId).classList.add("active");
    });
  });
}

// Export for testing in Node.js environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    state,
    EMISSION_FACTORS,
    calculateCurrentEmissions,
    SIMULATOR_ACTIONS
  };
}
