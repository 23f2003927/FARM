export const ROLES = {
  OWNER: 'owner',
  AGRONOMIST: 'agronomist',
  PROCUREMENT: 'procurement',
  SUPERVISOR: 'supervisor',
  VERIFIER: 'verifier',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner / Admin',
  agronomist: 'Agronomist',
  procurement: 'Procurement',
  supervisor: 'Supervisor',
  verifier: 'Verifier',
}

export const CROP_CYCLE_STATUSES = {
  PLANNING: 'planning',
  ACTIVE: 'active',
  HARVESTING: 'harvesting',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned',
} as const

export type CropCycleStatus = (typeof CROP_CYCLE_STATUSES)[keyof typeof CROP_CYCLE_STATUSES]

export const TREATMENT_STATUSES = {
  DRAFT: 'draft',
  NEEDS_CLARIFICATION: 'needs_clarification',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  RELEASED: 'released',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
} as const

export type TreatmentStatus = (typeof TREATMENT_STATUSES)[keyof typeof TREATMENT_STATUSES]

export const PRODUCT_CATEGORIES = {
  PESTICIDE: 'pesticide',
  FUNGICIDE: 'fungicide',
  INSECTICIDE: 'insecticide',
  FERTILIZER: 'fertilizer',
  BIOLOGICAL: 'biological',
  NUTRIENT: 'nutrient',
  PGR: 'plant_growth_regulator',
  ADJUVANT: 'adjuvant',
  OTHER: 'other',
} as const

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[keyof typeof PRODUCT_CATEGORIES]

export const VERIFICATION_STATUSES = {
  UNVERIFIED: 'unverified',
  PENDING: 'pending_verification',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
} as const

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[keyof typeof VERIFICATION_STATUSES]

export const STOCK_MOVEMENT_TYPES = {
  OPENING: 'opening_stock',
  RECEIPT: 'purchase_receipt',
  ISSUE: 'issue',
  RETURN: 'return',
  DISPOSAL: 'disposal',
  ADJUSTMENT: 'adjustment',
} as const

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[keyof typeof STOCK_MOVEMENT_TYPES]

export const MEASUREMENT_UNITS = {
  // Mass
  MG: 'mg',
  G: 'g',
  KG: 'kg',
  // Volume
  ML: 'ml',
  L: 'L',
  // Count
  PIECES: 'pieces',
} as const

export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[keyof typeof MEASUREMENT_UNITS]

export const UNIT_DIMENSIONS: Record<MeasurementUnit, 'mass' | 'volume' | 'count'> = {
  mg: 'mass',
  g: 'mass',
  kg: 'mass',
  ml: 'volume',
  L: 'volume',
  pieces: 'count',
}

// Conversion to base unit (g for mass, ml for volume)
export const UNIT_TO_BASE: Record<MeasurementUnit, number> = {
  mg: 0.001,
  g: 1,
  kg: 1000,
  ml: 1,
  L: 1000,
  pieces: 1,
}
