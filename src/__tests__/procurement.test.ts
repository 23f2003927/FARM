import { calculateProcurementRequirement } from '../lib/calculations/procurement'

// Run test cases matching the project specification (Part 10)
export function runProcurementTests() {
  const results: { testCase: string; passed: boolean; details: string }[] = []

  // Case 1: Demand 1 kg, stock 0 kg, pack size 5 kg. Expected: 1 package, 5 kg total, 4 kg excess
  const case1 = calculateProcurementRequirement({
    productTradeName: 'Copper Oxychloride',
    demandQuantity: 1,
    demandUnit: 'kg',
    usableStockQuantity: 0,
    stockUnit: 'kg',
    standardPackageSize: 5,
    packageUnit: 'kg',
  })
  const passed1 = case1.packagesToOrder === 1 && case1.totalOrderQuantity === 5 && case1.projectedExcess === 4
  results.push({
    testCase: 'Case 1: Demand 1 kg, Stock 0 kg, Pack 5 kg -> 1 pkg, 4 kg excess',
    passed: passed1,
    details: `Got: ${case1.packagesToOrder} pkgs, total ${case1.totalOrderQuantity} kg, excess ${case1.projectedExcess} kg`,
  })

  // Case 2: Demand 1 kg, stock 500 g, pack size 500 g. Expected: 1 package (demand 1kg = 1000g, net 500g, 1 pkg)
  const case2 = calculateProcurementRequirement({
    productTradeName: 'Ridomil Gold',
    demandQuantity: 1,
    demandUnit: 'kg',
    usableStockQuantity: 500,
    stockUnit: 'g',
    standardPackageSize: 500,
    packageUnit: 'g',
  })
  const passed2 = case2.packagesToOrder === 1 && case2.netRequirement === 500
  results.push({
    testCase: 'Case 2: Demand 1 kg, Stock 500 g, Pack 500 g -> 1 pkg',
    passed: passed2,
    details: `Got: ${case2.packagesToOrder} pkgs, net ${case2.netRequirement} g`,
  })

  // Case 3: Demand 1 kg, usable stock 1 kg. Expected: 0 packages
  const case3 = calculateProcurementRequirement({
    productTradeName: '19:19:19 NPK',
    demandQuantity: 1,
    demandUnit: 'kg',
    usableStockQuantity: 1,
    stockUnit: 'kg',
    standardPackageSize: 25,
    packageUnit: 'kg',
  })
  const passed3 = case3.packagesToOrder === 0 && case3.totalOrderQuantity === 0
  results.push({
    testCase: 'Case 3: Demand 1 kg, Stock 1 kg -> 0 pkgs',
    passed: passed3,
    details: `Got: ${case3.packagesToOrder} pkgs, total ${case3.totalOrderQuantity} kg`,
  })

  // Case 4: Demand 2 kg, usable stock 1 kg, confirmed incoming 1 kg. Expected: 0 packages
  const case4 = calculateProcurementRequirement({
    productTradeName: 'Calcium Nitrate',
    demandQuantity: 2,
    demandUnit: 'kg',
    usableStockQuantity: 1,
    stockUnit: 'kg',
    confirmedIncomingQuantity: 1,
    standardPackageSize: 10,
    packageUnit: 'kg',
  })
  const passed4 = case4.packagesToOrder === 0 && case4.netRequirement === 0
  results.push({
    testCase: 'Case 4: Demand 2 kg, Stock 1 kg, Incoming 1 kg -> 0 pkgs',
    passed: passed4,
    details: `Got: ${case4.packagesToOrder} pkgs, net ${case4.netRequirement} kg`,
  })

  // Case 5: Mass compared to Volume (1 kg demand vs ml stock). Expected: Validation Error, No conversion
  const case5 = calculateProcurementRequirement({
    productTradeName: 'Confidor 200 SL',
    demandQuantity: 1,
    demandUnit: 'kg', // mass
    usableStockQuantity: 250,
    stockUnit: 'ml', // volume
    standardPackageSize: 250,
    packageUnit: 'ml',
  })
  const passed5 = !case5.isValid && !!case5.errorMessage?.includes('Dimension mismatch')
  results.push({
    testCase: 'Case 5: Mass demand (kg) vs Volume stock (ml) -> Blocked with Validation Error',
    passed: passed5,
    details: `Got isValid: ${case5.isValid}, Error: ${case5.errorMessage}`,
  })

  return results
}
