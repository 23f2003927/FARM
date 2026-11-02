import { UNIT_DIMENSIONS, UNIT_TO_BASE, type MeasurementUnit } from '@/types/enums'

export interface ProcurementCalculationInput {
  productTradeName: string
  demandQuantity: number
  demandUnit: string
  usableStockQuantity: number
  stockUnit: string
  confirmedIncomingQuantity?: number
  desiredEndingStock?: number
  standardPackageSize?: number
  packageUnit?: string
}

export interface ProcurementCalculationResult {
  productTradeName: string
  baseUnit: string
  normalizedDemand: number
  normalizedUsableStock: number
  normalizedIncoming: number
  desiredEndingStock: number
  netRequirement: number
  packageSize: number
  packagesToOrder: number
  totalOrderQuantity: number
  projectedExcess: number
  isValid: boolean
  errorMessage?: string
}

/**
 * Validates unit compatibility and converts to base unit (grams for mass, ml for volume).
 * Non-negotiable rule: Cross-dimensional conversions (e.g. g to ml) are strictly prohibited.
 */
export function convertToBaseUnit(
  quantity: number,
  unit: string
): { baseQuantity: number; dimension: 'mass' | 'volume' | 'count'; baseUnit: string } {
  const normUnit = unit as MeasurementUnit
  const dimension = UNIT_DIMENSIONS[normUnit]

  if (!dimension) {
    throw new Error(`Unsupported measurement unit: ${unit}`)
  }

  const factor = UNIT_TO_BASE[normUnit] || 1
  const baseUnit = dimension === 'mass' ? 'g' : dimension === 'volume' ? 'ml' : 'pieces'

  return {
    baseQuantity: quantity * factor,
    dimension,
    baseUnit,
  }
}

/**
 * Core Procurement Calculator
 * Formula:
 * Net Purchase Requirement = MAX(0, Planned Demand + Desired Ending Stock - Usable Stock - Confirmed Incoming Stock)
 * Packages to Order = CEILING(Net Purchase Requirement / Package Size)
 * Total Order Quantity = Packages to Order * Package Size
 * Projected Excess = Total Order Quantity - Net Purchase Requirement
 */
export function calculateProcurementRequirement(
  input: ProcurementCalculationInput
): ProcurementCalculationResult {
  try {
    // 1. Validate and convert demand
    const demand = convertToBaseUnit(input.demandQuantity, input.demandUnit)

    // 2. Validate and convert usable stock
    const stock = convertToBaseUnit(input.usableStockQuantity, input.stockUnit)

    // 3. Strict dimension check: Mass cannot be converted to Volume
    if (demand.dimension !== stock.dimension) {
      return {
        productTradeName: input.productTradeName,
        baseUnit: demand.baseUnit,
        normalizedDemand: demand.baseQuantity,
        normalizedUsableStock: stock.baseQuantity,
        normalizedIncoming: 0,
        desiredEndingStock: 0,
        netRequirement: 0,
        packageSize: 0,
        packagesToOrder: 0,
        totalOrderQuantity: 0,
        projectedExcess: 0,
        isValid: false,
        errorMessage: `Dimension mismatch: Planned demand is in ${demand.dimension} (${input.demandUnit}), but product stock is tracked in ${stock.dimension} (${input.stockUnit}). Automatic conversion between mass and volume is strictly prohibited.`,
      }
    }

    // 4. Incoming stock and desired ending stock
    const incomingBase = input.confirmedIncomingQuantity
      ? convertToBaseUnit(input.confirmedIncomingQuantity, input.stockUnit).baseQuantity
      : 0
    const desiredEndingBase = input.desiredEndingStock
      ? convertToBaseUnit(input.desiredEndingStock, input.stockUnit).baseQuantity
      : 0

    // 5. Net Requirement
    const netBase = Math.max(
      0,
      demand.baseQuantity + desiredEndingBase - stock.baseQuantity - incomingBase
    )

    // 6. Package Size
    const rawPackageSize = input.standardPackageSize || 1
    const packUnit = input.packageUnit || input.stockUnit
    const packageBase = convertToBaseUnit(rawPackageSize, packUnit).baseQuantity

    // 7. Packages to Order (Always CEILING)
    const packages = netBase > 0 ? Math.ceil(netBase / packageBase) : 0
    const totalOrderedBase = packages * packageBase
    const excessBase = Math.max(0, totalOrderedBase - netBase)

    // Convert back from base to user stock unit
    const stockFactor = UNIT_TO_BASE[input.stockUnit as MeasurementUnit] || 1

    return {
      productTradeName: input.productTradeName,
      baseUnit: input.stockUnit,
      normalizedDemand: Number((demand.baseQuantity / stockFactor).toFixed(4)),
      normalizedUsableStock: Number((stock.baseQuantity / stockFactor).toFixed(4)),
      normalizedIncoming: Number((incomingBase / stockFactor).toFixed(4)),
      desiredEndingStock: Number((desiredEndingBase / stockFactor).toFixed(4)),
      netRequirement: Number((netBase / stockFactor).toFixed(4)),
      packageSize: Number((packageBase / stockFactor).toFixed(4)),
      packagesToOrder: packages,
      totalOrderQuantity: Number((totalOrderedBase / stockFactor).toFixed(4)),
      projectedExcess: Number((excessBase / stockFactor).toFixed(4)),
      isValid: true,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown validation error'
    return {
      productTradeName: input.productTradeName,
      baseUnit: input.stockUnit,
      normalizedDemand: 0,
      normalizedUsableStock: 0,
      normalizedIncoming: 0,
      desiredEndingStock: 0,
      netRequirement: 0,
      packageSize: 0,
      packagesToOrder: 0,
      totalOrderQuantity: 0,
      projectedExcess: 0,
      isValid: false,
      errorMessage: message,
    }
  }
}
