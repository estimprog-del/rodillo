/**
 * Virtual shifting configuration.
 *
 * Ratios are intentionally progressive rather than tied to the physical
 * drivetrain: the rider can leave the real bicycle in one fixed gear while
 * the application changes the virtual resistance.
 */
export const VIRTUAL_GEAR_COUNT = 24;
export const DEFAULT_VIRTUAL_GEAR = 12;
export const MIN_VIRTUAL_GEAR = 1;
export const MAX_VIRTUAL_GEAR = VIRTUAL_GEAR_COUNT;

const MIN_GEAR_RATIO = 1.0;
const MAX_GEAR_RATIO = 4.5;

export const VIRTUAL_GEAR_RATIOS = Object.freeze(
  Array.from({ length: VIRTUAL_GEAR_COUNT }, (_, index) => {
    const progress = index / (VIRTUAL_GEAR_COUNT - 1);
    return MIN_GEAR_RATIO * Math.pow(MAX_GEAR_RATIO / MIN_GEAR_RATIO, progress);
  }),
);

export function clampVirtualGear(gear) {
  const numericGear = Number(gear);
  if (!Number.isFinite(numericGear)) return DEFAULT_VIRTUAL_GEAR;
  return Math.max(MIN_VIRTUAL_GEAR, Math.min(MAX_VIRTUAL_GEAR, Math.round(numericGear)));
}

export function getVirtualGearRatio(gear) {
  return VIRTUAL_GEAR_RATIOS[clampVirtualGear(gear) - 1];
}

/**
 * Converts route grade into the grade sent to an interactive trainer.
 *
 * Gear 12 is neutral, so existing route behaviour is preserved there.
 * The additive term makes gear changes effective on flat terrain too,
 * while the multiplicative term preserves the route gradient response.
 */
export function calculateVirtualResistanceSlope(terrainSlope, gear) {
  const safeSlope = Number.isFinite(Number(terrainSlope)) ? Number(terrainSlope) : 0;
  const selectedRatio = getVirtualGearRatio(gear);
  const neutralRatio = getVirtualGearRatio(DEFAULT_VIRTUAL_GEAR);
  const ratioFactor = selectedRatio / neutralRatio;
  const gearBias = (ratioFactor - 1) * 2;

  return safeSlope * ratioFactor + gearBias;
}

export function formatVirtualGear(gear) {
  const selectedGear = clampVirtualGear(gear);
  return `Marcha: ${selectedGear} / ${VIRTUAL_GEAR_COUNT}`;
}
