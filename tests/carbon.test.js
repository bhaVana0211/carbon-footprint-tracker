const {
  state,
  EMISSION_FACTORS,
  calculateCurrentEmissions,
  SIMULATOR_ACTIONS
} = require('../app');

describe('Carbon Footprint Tracker Calculations', () => {
  let originalInputs;

  beforeAll(() => {
    // Deep clone the original state inputs to restore them after each test
    originalInputs = JSON.parse(JSON.stringify(state.inputs));
  });

  afterEach(() => {
    // Restore inputs to avoid test contamination
    state.inputs = JSON.parse(JSON.stringify(originalInputs));
  });

  // Test 1: Standard inputs (default state)
  test('should calculate correct emissions for standard inputs', () => {
    const result = calculateCurrentEmissions();

    // Transport check:
    // car: 12000 * 0.170 (petrol) = 2040
    // transit: 50 * 52 * 0.040 (transit) = 104
    // short flights: 2 * 150.0 = 300
    // long flights: 0 * 600.0 = 0
    // Expected Transport total = 2444 kg CO2e
    expect(result.transport).toBeCloseTo(2444, 2);

    // Food check:
    // beef: 3 * 52 * 6.5 = 1014
    // dairy: 10 * 52 * 1.2 = 624
    // baseOther (moderate-meat) = 700
    // raw total = 2338
    // sourcing multiplier (average) = 1 + 0 = 1.0
    // Expected Food total = 2338 kg CO2e
    expect(result.food).toBeCloseTo(2338, 2);

    // Energy check:
    // electricity: 350 * 12 * 0.38 (electricity) * (1 - 0) = 1596
    // heating: 500 * 12 * 0.180 (natural-gas) = 1080
    // Expected Energy total = 2676 kg CO2e
    expect(result.energy).toBeCloseTo(2676, 2);

    // Total check:
    // Expected Grand total = 2444 + 2338 + 2676 = 7458 kg CO2e
    expect(result.total).toBeCloseTo(7458, 2);
  });

  // Test 2: Edge Case - Zero values for inputs
  test('should handle zero inputs correctly (checking baseline food emissions)', () => {
    state.inputs.carDistance = 0;
    state.inputs.transitDistance = 0;
    state.inputs.shortFlights = 0;
    state.inputs.longFlights = 0;
    state.inputs.beefServings = 0;
    state.inputs.dairyServings = 0;
    state.inputs.electricityUsage = 0;
    state.inputs.heatingUsage = 0;
    state.inputs.dietProfile = 'vegan';
    state.inputs.foodSourcing = 'local';

    const result = calculateCurrentEmissions();

    // Transport and Energy should be zero
    expect(result.transport).toBe(0);
    expect(result.energy).toBe(0);

    // Food calculation:
    // beef = 0, dairy = 0, baseOther ('vegan') = 450
    // sourcing multiplier (local) = 1 + (-0.15) = 0.85
    // Food total = 450 * 0.85 = 382.5 kg CO2e
    expect(result.food).toBeCloseTo(382.5, 2);
    expect(result.total).toBeCloseTo(382.5, 2);
  });

  // Test 3: Edge Case - Negative values
  test('should handle negative inputs mathematically correctly based on formulas', () => {
    state.inputs.carDistance = -5000; // negative driving distance
    state.inputs.transitDistance = 0;
    state.inputs.shortFlights = 0;
    state.inputs.longFlights = 0;
    state.inputs.beefServings = 0;
    state.inputs.dairyServings = 0;
    state.inputs.electricityUsage = 0;
    state.inputs.heatingUsage = 0;
    state.inputs.dietProfile = 'vegan';
    state.inputs.foodSourcing = 'average';

    const result = calculateCurrentEmissions();

    // car emissions = -5000 * 0.170 = -850 kg CO2e
    expect(result.transport).toBeCloseTo(-850, 2);
    // food emissions = 450 * 1.0 = 450 kg CO2e
    expect(result.food).toBeCloseTo(450, 2);
    // grand total = -850 + 450 = -400 kg CO2e
    expect(result.total).toBeCloseTo(-400, 2);
  });

  // Test 4: Simulator actions savings calculation
  test('should calculate savings correctly for various simulator actions', () => {
    // Walk Short action
    const walkShortAction = SIMULATOR_ACTIONS.find(a => a.id === 'walk_short');
    expect(walkShortAction).toBeDefined();

    // Default car distance 12000, petrol. carEmissions = 12000 * 0.170 = 2040
    // Math.min(500, 2040) -> 500
    let walkShortSaving = walkShortAction.calculate(state.inputs, 2444);
    expect(walkShortSaving).toBeCloseTo(500, 2);

    // Lower car distance: carDistance = 100, petrol. carEmissions = 100 * 0.170 = 17
    // Math.min(500, 17) -> 17
    state.inputs.carDistance = 100;
    walkShortSaving = walkShortAction.calculate(state.inputs, 17);
    expect(walkShortSaving).toBeCloseTo(17, 2);

    // Switch EV action
    const switchEvAction = SIMULATOR_ACTIONS.find(a => a.id === 'switch_ev');
    expect(switchEvAction).toBeDefined();

    // If vehicle is already electric, saving should be 0
    state.inputs.fuelType = 'electric';
    let evSaving = switchEvAction.calculate(state.inputs, 2444);
    expect(evSaving).toBeCloseTo(0, 2);

    // If vehicle is petrol, distance is 10000
    // currentCar = 10000 * 0.170 = 1700
    // evCar = 10000 * 0.045 = 450
    // saving = Math.max(0, 1700 - 450) = 1250
    state.inputs.fuelType = 'petrol';
    state.inputs.carDistance = 10000;
    evSaving = switchEvAction.calculate(state.inputs, 2444);
    expect(evSaving).toBeCloseTo(1250, 2);
  });
});
