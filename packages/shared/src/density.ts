export interface DensityInput {
  length: number;
  width: number;
  height: number;
  dimensionUnit: string;
  quantity: number;
  weight: number;
  weightUnit: string;
}

const CUBIC_INCHES_PER_CUBIC_FOOT = 1_728;
const POUNDS_PER_KILOGRAM = 2.20462;

/** Calculates shipment density in pounds per cubic foot. Weight is the total shipment weight. */
export function calculateDensity(input: DensityInput): number | null {
  const { length, width, height, quantity, weight } = input;
  if (![length, width, height, quantity, weight].every((value) => Number.isFinite(value) && value > 0)) {
    return null;
  }

  const dimensionUnit = input.dimensionUnit.toLowerCase();
  const inchesPerUnit = dimensionUnit === "ft" ? 12 : dimensionUnit === "cm" ? 0.3937007874 : dimensionUnit === "in" ? 1 : null;
  if (inchesPerUnit === null) return null;

  const totalCubicFeet = (length * width * height * inchesPerUnit ** 3 * quantity) / CUBIC_INCHES_PER_CUBIC_FOOT;
  const weightUnit = input.weightUnit.toLowerCase();
  const totalWeightPounds = weightUnit === "kg" ? weight * POUNDS_PER_KILOGRAM : weightUnit === "lb" ? weight : null;
  if (totalWeightPounds === null || totalCubicFeet <= 0) return null;

  return totalWeightPounds / totalCubicFeet;
}

/** Returns the standard density-based LTL freight class shown in the data-entry requirements. */
export function freightClassForDensity(density: number | null): string | null {
  if (density === null || !Number.isFinite(density) || density < 0) return null;
  if (density < 1) return "400";
  if (density < 2) return "300";
  if (density < 4) return "250";
  if (density < 6) return "175";
  if (density < 8) return "125";
  if (density < 10) return "100";
  if (density < 12) return "92.5";
  if (density < 15) return "85";
  if (density < 22.5) return "70";
  if (density < 30) return "65";
  return "60";
}
