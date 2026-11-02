import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PRODUCT_CATEGORIES, MEASUREMENT_UNITS } from '@/types/enums'

export default async function NewProductPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const isAuthorized = memberships?.roles?.some((r: string) => ['owner', 'agronomist'].includes(r))
  if (!isAuthorized) {
    redirect('/dashboard/products')
  }

  // Server Action to insert product
  async function createProduct(formData: FormData) {
    'use server'
    const tradeName = formData.get('trade_name') as string
    const category = formData.get('category') as string
    const brand = formData.get('brand') as string
    const activeIngredient = formData.get('active_ingredient') as string
    const concentration = formData.get('concentration') as string
    const formulation = formData.get('formulation') as string
    const manufacturer = formData.get('manufacturer') as string
    const target = formData.get('target_crops_pests') as string
    const packSize = formData.get('standard_package_size') ? parseFloat(formData.get('standard_package_size') as string) : null
    const packUnit = formData.get('package_unit') as string
    const stockUnit = formData.get('stock_unit') as string
    const minStock = formData.get('minimum_stock_level') ? parseFloat(formData.get('minimum_stock_level') as string) : 0
    const storageInstructions = formData.get('storage_instructions') as string
    const initialAlias = formData.get('initial_alias') as string

    if (!tradeName?.trim() || !category || !stockUnit) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (!m?.farm_id) return

    // If inserted by Agronomist, can mark as verified; if by Owner, defaults to unverified
    const isAgronomist = m.roles.includes('agronomist')

    const { data: insertedProduct, error } = await supabase
      .from('product_catalog')
      .insert({
        farm_id: m.farm_id,
        trade_name: tradeName.trim(),
        category,
        brand: brand?.trim() || null,
        active_ingredient: activeIngredient?.trim() || null,
        concentration: concentration?.trim() || null,
        formulation: formulation?.trim() || null,
        manufacturer: manufacturer?.trim() || null,
        target_crops_pests: target?.trim() || null,
        standard_package_size: packSize,
        package_unit: packUnit || null,
        stock_unit: stockUnit,
        minimum_stock_level: minStock,
        storage_instructions: storageInstructions?.trim() || null,
        verification_status: isAgronomist ? 'verified' : 'unverified',
        verified_by: isAgronomist ? user?.id : null,
        verified_at: isAgronomist ? new Date().toISOString() : null,
      })
      .select('id')
      .single()

    if (!error && insertedProduct) {
      if (initialAlias?.trim()) {
        await supabase.from('product_aliases').insert({
          farm_id: m.farm_id,
          product_id: insertedProduct.id,
          alias_name: initialAlias.trim(),
          alias_type: 'commercial',
        })
      }
      redirect(`/dashboard/products/${insertedProduct.id}`)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Add New Agricultural Input"
        description="Register a canonical product with exact active ingredient, concentration, and packaging units"
        actions={
          <Link
            href="/dashboard/products"
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md font-medium transition-colors"
          >
            ← Back to Catalogue
          </Link>
        }
      />

      <div className="bg-white border border-gray-200 rounded-lg shadow-xs p-6">
        <form action={createProduct} className="space-y-6">
          {/* Identity & Classification */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 border-b border-gray-100 pb-2 mb-4">
              1. Product Identity & Classification
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Commercial / Trade Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="trade_name"
                  placeholder="e.g. Confidor 200 SL, Ridomil Gold MZ"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Product Category <span className="text-red-500">*</span>
                </label>
                <select
                  name="category"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Select Category</option>
                  {Object.values(PRODUCT_CATEGORIES).map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.replace(/_/g, ' ').toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Brand / Distributor
                </label>
                <input
                  type="text"
                  name="brand"
                  placeholder="e.g. Bayer, Syngenta, Yara, Mahadhan"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Manufacturer
                </label>
                <input
                  type="text"
                  name="manufacturer"
                  placeholder="e.g. Bayer CropScience Ltd"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>
          </div>

          {/* Chemical & Formulation Specs */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 border-b border-gray-100 pb-2 mb-4">
              2. Active Ingredient & Technical Specifications
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Generic Composition / Active Ingredient
                </label>
                <input
                  type="text"
                  name="active_ingredient"
                  placeholder="e.g. Imidacloprid, Mancozeb + Metalaxyl"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Concentration / Strength
                </label>
                <input
                  type="text"
                  name="concentration"
                  placeholder="e.g. 17.8% SL, 68% WP, 19:19:19"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Formulation Type / Grade
                </label>
                <input
                  type="text"
                  name="formulation"
                  placeholder="e.g. Soluble Liquid (SL), Wettable Powder (WP)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Approved Target Crops & Diseases / Pests
              </label>
              <input
                type="text"
                name="target_crops_pests"
                placeholder="e.g. Capsicum: Thrips, Mites; Tomato: Late blight; Cucumber: Downy mildew"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {/* Units & Packaging */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 border-b border-gray-100 pb-2 mb-4">
              3. Measurement Units & Packaging
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Package Size
                </label>
                <input
                  type="number"
                  step="0.0001"
                  name="standard_package_size"
                  placeholder="e.g. 250, 1, 25"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Package Unit
                </label>
                <select
                  name="package_unit"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Select Unit</option>
                  {Object.values(MEASUREMENT_UNITS).map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Stock Unit <span className="text-red-500">*</span>
                </label>
                <select
                  name="stock_unit"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white font-semibold outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Select Ledger Unit</option>
                  {Object.values(MEASUREMENT_UNITS).map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-gray-400 mt-0.5 block">
                  All inventory movements will be recorded in this unit.
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Minimum Stock Threshold
                </label>
                <input
                  type="number"
                  step="0.0001"
                  name="minimum_stock_level"
                  defaultValue="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>
          </div>

          {/* Shorthand & Storage */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 border-b border-gray-100 pb-2 mb-4">
              4. Aliases & Handling
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Initial Common Alias / Shorthand (Optional)
                </label>
                <input
                  type="text"
                  name="initial_alias"
                  placeholder="e.g. Agronomist slang or supplier name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
                <span className="text-[10px] text-gray-400 mt-0.5 block">
                  You can add multiple aliases later from the product details page.
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Storage & Handling Instructions
                </label>
                <input
                  type="text"
                  name="storage_instructions"
                  placeholder="e.g. Store in cool, dry place away from sunlight. Keep locked."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-200 flex justify-end gap-3">
            <Link
              href="/dashboard/products"
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
            >
              Save Product
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

