import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function ReceiveStockPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id
  const canReceive = memberships?.roles?.some((r: string) => ['owner', 'procurement'].includes(r))
  if (!canReceive) {
    redirect('/dashboard/inventory')
  }

  const [{ data: products }, { data: suppliers }] = await Promise.all([
    supabase
      .from('product_catalog')
      .select('id, trade_name, stock_unit, standard_package_size, package_unit')
      .eq('farm_id', farmId)
      .eq('is_archived', false)
      .order('trade_name', { ascending: true }),
    supabase
      .from('suppliers')
      .select('id, name')
      .eq('farm_id', farmId)
      .eq('is_active', true)
      .order('name', { ascending: true }),
  ])

  // Server Action: Process Goods Receipt / Opening Stock
  async function receiveStock(formData: FormData) {
    'use server'
    const productId = formData.get('product_id') as string
    const movementType = (formData.get('movement_type') as string) || 'purchase_receipt'
    const batchNumber = formData.get('batch_number') as string
    const supplierId = (formData.get('supplier_id') as string) || null
    const mfgDate = (formData.get('mfg_date') as string) || null
    const expDate = (formData.get('expiry_date') as string) || null
    const packageSize = formData.get('package_size') ? parseFloat(formData.get('package_size') as string) : null
    const packageCount = formData.get('package_count') ? parseFloat(formData.get('package_count') as string) : 1
    const totalQuantity = formData.get('total_quantity') ? parseFloat(formData.get('total_quantity') as string) : null
    const location = formData.get('storage_location') as string
    const invoiceRef = formData.get('invoice_ref') as string
    const reason = formData.get('reason') as string

    if (!productId || !batchNumber?.trim() || !totalQuantity) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (!m?.farm_id) return

    // Get product stock unit to ensure exact match
    const { data: prod } = await supabase
      .from('product_catalog')
      .select('stock_unit')
      .eq('id', productId)
      .eq('farm_id', m.farm_id)
      .single()

    if (!prod) return

    // 1. Create or Find Batch
    const { data: batch, error: batchError } = await supabase
      .from('product_batches')
      .upsert({
        farm_id: m.farm_id,
        product_id: productId,
        batch_number: batchNumber.trim(),
        supplier_id: supplierId || null,
        manufacturing_date: mfgDate || null,
        expiry_date: expDate || null,
        package_size: packageSize,
        package_unit: prod.stock_unit,
        initial_quantity: totalQuantity,
        quantity_unit: prod.stock_unit,
        storage_location: location?.trim() || 'General Store',
        purchase_invoice_ref: invoiceRef?.trim() || null,
        status: 'available',
      }, { onConflict: 'farm_id,product_id,batch_number' })
      .select('id')
      .single()

    if (batchError || !batch) return

    // 2. Insert Append-Only Stock Movement
    await supabase.rpc('fn_record_stock_movement', {
      p_farm_id: m.farm_id,
      p_product_id: productId,
      p_batch_id: batch.id,
      p_movement_type: movementType,
      p_quantity: Math.abs(totalQuantity), // positive inbound
      p_unit: prod.stock_unit,
      p_reference_type: movementType === 'opening_stock' ? 'opening_balance' : 'invoice',
      p_reason: reason?.trim() || (movementType === 'opening_stock' ? 'Physical stock opening balance' : `Goods received per invoice ${invoiceRef || 'N/A'}`),
    })

    redirect('/dashboard/inventory')
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Record Goods Receipt / Opening Stock"
        description="Every input movement creates an immutable batch record and append-only stock movement entry"
        actions={
          <Link
            href="/dashboard/inventory"
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md font-medium transition-colors"
          >
            ← Back to Inventory
          </Link>
        }
      />

      <div className="bg-white border border-gray-200 rounded-lg shadow-xs p-6">
        <form action={receiveStock} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Transaction Type <span className="text-red-500">*</span>
              </label>
              <select
                name="movement_type"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white font-medium outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="purchase_receipt">Purchase Receipt (Supplier Inbound)</option>
                <option value="opening_stock">Initial Physical Opening Stock</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Product <span className="text-red-500">*</span>
              </label>
              <select
                name="product_id"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white font-semibold outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Select Product</option>
                {products?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.trade_name} (Ledger Unit: {p.stock_unit})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Batch / Lot Number <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="batch_number"
                placeholder="e.g. BATCH-2026-X1"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Supplier
              </label>
              <select
                name="supplier_id"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Direct / Not specified</option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Invoice / Challan Reference
              </label>
              <input
                type="text"
                name="invoice_ref"
                placeholder="e.g. INV-88219"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Manufacturing Date
              </label>
              <input
                type="date"
                name="mfg_date"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Expiry Date (FEFO Tracking)
              </label>
              <input
                type="date"
                name="expiry_date"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-3">
              Packaging & Received Quantity
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Package Size
                </label>
                <input
                  type="number"
                  step="0.0001"
                  name="package_size"
                  placeholder="e.g. 500 (g), 1 (kg)"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Package Count (Boxes/Bottles)
                </label>
                <input
                  type="number"
                  step="1"
                  name="package_count"
                  defaultValue="1"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-900 mb-1">
                  Total Quantity Received <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.0001"
                  name="total_quantity"
                  placeholder="e.g. 500, 1000"
                  required
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs font-bold font-mono bg-white outline-none focus:ring-1 focus:ring-green-500"
                />
                <span className="text-[10px] text-gray-500 mt-0.5 block">
                  Must be entered in product's stock unit.
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-gray-200/60">
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Storage Location
                </label>
                <input
                  type="text"
                  name="storage_location"
                  placeholder="e.g. Chemical Room - Shelf A2"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Audit Notes / Reason
                </label>
                <input
                  type="text"
                  name="reason"
                  placeholder="e.g. Regular seasonal purchase for Capsicum cycle"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Link
              href="/dashboard/inventory"
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
            >
              Record Inbound Stock
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

