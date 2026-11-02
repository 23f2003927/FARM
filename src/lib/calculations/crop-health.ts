/**
 * Pure calculation helper for Crop Health & Scouting
 * Formula: Incidence (%) = (Affected Plants / Plants Checked) * 100
 * Requirement: Guard against division by zero (zero plants checked returns 0.00)
 */

export function calculateIncidencePercentage(
  plantsChecked: number,
  plantsAffected: number
): { incidencePct: number; isValid: boolean; errorMessage?: string } {
  if (plantsChecked < 0 || plantsAffected < 0) {
    return {
      incidencePct: 0,
      isValid: false,
      errorMessage: 'Plant counts cannot be negative.',
    }
  }

  if (plantsAffected > plantsChecked) {
    return {
      incidencePct: 0,
      isValid: false,
      errorMessage: 'Affected plants cannot exceed total plants checked.',
    }
  }

  if (plantsChecked === 0) {
    return {
      incidencePct: 0,
      isValid: true,
    }
  }

  const raw = (plantsAffected / plantsChecked) * 100
  const rounded = Number(raw.toFixed(2))

  return {
    incidencePct: rounded,
    isValid: true,
  }
}

