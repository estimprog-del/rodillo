/**
 * Virtual shifting configuration based on a compact real-world drivetrain.
 *
 * The rider can leave the physical bicycle in one fixed gear while the
 * application changes the virtual resistance using these drivetrain ratios.
 */
export const REAL_SEQUENTIAL_GEARS = Object.freeze([
  { label: "34x34", ratio: 1.00 },
  { label: "34x30", ratio: 1.13 },
  { label: "34x27", ratio: 1.26 },
  { label: "34x24", ratio: 1.42 },
  { label: "34x21", ratio: 1.62 },
  { label: "34x19", ratio: 1.79 },
  { label: "50x24", ratio: 2.08 },
  { label: "50x21", ratio: 2.38 },
  { label: "50x17", ratio: 2.94 },
  { label: "50x15", ratio: 3.33 },
  { label: "50x14", ratio: 3.57 },
  { label: "50x13", ratio: 3.85 },
  { label: "50x12", ratio: 4.17 },
  { label: "50x11", ratio: 4.55 },
]);

export const VIRTUAL_GEAR_COUNT = REAL_SEQUENTIAL_GEARS.length;
export const DEFAULT_VIRTUAL_GEAR = 9;
export const MIN_VIRTUAL_GEAR = 1;
export const MAX_VIRTUAL_GEAR = VIRTUAL_GEAR_COUNT;

export const VIRTUAL_GEAR_RATIOS = Object.freeze(
  REAL_SEQUENTIAL_GEARS.map(({ ratio }) => ratio),
);

export function clampVirtualGear(gear) {
  const numericGear = Number(gear);
  if (!Number.isFinite(numericGear)) return DEFAULT_VIRTUAL_GEAR;
  return Math.max(MIN_VIRTUAL_GEAR, Math.min(MAX_VIRTUAL_GEAR, Math.round(numericGear)));
}

export function getVirtualGearRatio(gear) {
  return VIRTUAL_GEAR_RATIOS[clampVirtualGear(gear) - 1];
}

export function getVirtualGearLabel(gear) {
  return REAL_SEQUENTIAL_GEARS[clampVirtualGear(gear) - 1].label;
}

/**
 * Converts route grade into the grade sent to an interactive trainer.
 *
 * Gear 9 is neutral, so route behaviour is preserved there. The additive
 * term makes gear changes effective on flat terrain while the multiplicative
 * term preserves the route gradient response.
 */
export function calculateVirtualResistanceSlope(terrainSlope, gear) {
  const safeSlope = Number.isFinite(Number(terrainSlope))
    ? Number(terrainSlope)
    : 0;

  const selectedRatio = getVirtualGearRatio(gear);
  const neutralRatio = getVirtualGearRatio(DEFAULT_VIRTUAL_GEAR);
  const ratioFactor = selectedRatio / neutralRatio;

  const WIND_FRICTION_SIM = 0.8;
  const effectiveBaseSlope = safeSlope + WIND_FRICTION_SIM;

  let virtualSlope = effectiveBaseSlope * ratioFactor - WIND_FRICTION_SIM;

  // Short gears must not turn flat terrain or climbs into artificial descents.
  if (safeSlope >= 0 && virtualSlope < 0) {
    virtualSlope = 0;
  }

  // Long gears soften descents; short gears retain the route's original grade.
  if (safeSlope < 0) {
    virtualSlope = ratioFactor > 1 ? safeSlope / ratioFactor : safeSlope;
  }

  return virtualSlope;
}
export function formatVirtualGear(gear) {
  const selectedGear = clampVirtualGear(gear);
  return `Marcha: ${selectedGear} / ${VIRTUAL_GEAR_COUNT} · ${getVirtualGearLabel(selectedGear)}`;
}
