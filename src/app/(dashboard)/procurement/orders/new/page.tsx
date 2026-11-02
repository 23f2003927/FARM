import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function NewPurchaseOrderPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id
  const canCreate = memberships?.roles?.some((r: string) => ['owner', 'procurement'].includes(r))
  if (!canCreate) {
    redirect('/dashboard/procurement/orders')
  }

  const [{ data: suppliers }, { data: products }] = await Promise.all([
    supabase.from('suppliers').select('id, name').eq('farm_id', farmId).eq('is_active', true),
    supabase.from('product_catalog').select('id, trade_name, stock_unit, standard_package_size, package_unit').eq('farm_id', farmId).eq('is_archived', false),
  ])

  // Server Action: Create Purchase Order
  async function createPurchaseOrder(formData: FormData) {
    'use server'
    const poNumber = formData.get('po_number') as string
    const supplierId = formData.get('supplier_id') as string
    const expectedDate = formData.get('expected_delivery_date') as string
    const notes = formData.get('notes') as string

    // Line 1
    const productId = formData.get('product_id') as string
    const packagesOrdered = formData.get('packages_ordered') ? parseInt(formData.get('packages_ordered') as string) : 1
    const packageSize = formData.get('package_size') ? parseFloat(formData.get('package_size') as string) : 1
    const unitPrice = formData.get('unit_price') ? parseFloat(formData.get('unit_price') as string) : 0

    if (!poNumber?.trim() || !supplierId || !productId) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (!m?.farm_id) return

    const { data: prod } = await supabase
      .from('product_catalog')
      .select('stock_unit')
      .eq('id', productId)
      .eq('farm_id', m.farm_id)
      .single()

    if (!prod) return

    const totalQty = packagesOrdered * packageSize
    const totalPrice = totalQty * unitPrice

    // 1. Create PO
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        farm_id: m.farm_id,
        po_number: poNumber.trim(),
        supplier_id: supplierId,
        expected_delivery_date: expectedDate || null,
        notes: notes?.trim() || null,
        total_amount: totalPrice,
        status: 'draft',
        created_by: user?.id,
      })
      .select('id')
      .single()

    if (poError || !po) return

    // 2. Insert PO Line
    await supabase.from('purchase_order_lines').insert({
      purchase_order_id: po.id,
      farm_id: m.farm_id,
      product_id: productId,
      quantity_ordered: totalQty,
      unit: prod.stock_unit,
      packages_ordered: packagesOrdered,
      package_size: packageSize,
      unit_price: unitPrice,
      total_price: totalPrice,
      quantity_received: 0,
      status: 'pending',
    })

    redirect(`/dashboard/procurement/orders/${po.id}`)
  }

  const generatedPoNumber = `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Draft Purchase Order"
        description="Formal supplier procurement order. Inventory is NOT updated until physical goods receipt is confirmed."
        actions={
          <Link
            href="/dashboard/procurement/orders"
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md font-medium transition-colors"
          >
            ← Back to Orders
          </Link>
        }
      />

      <div className="bg-white border border-gray-200 rounded-lg shadow-xs p-6">
        <form action={createPurchaseOrder} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Purchase Order # <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="po_number"
                defaultValue={generatedPoNumber}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono font-bold outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Supplier <span className="text-red-500">*</span>
              </label>
              <select
                name="supplier_id"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white font-medium outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Select Supplier</option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Expected Delivery Date
              </label>
              <input
                type="date"
                name="expected_delivery_date"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Internal Order Notes
              </label>
              <input
                type="text"
                name="notes"
                placeholder="e.g. Bulk order for monthly polyhouse fertigation"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {/* Line 1 Item */}
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-3">
              Ordered Product (Line Item 1)
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Product <span className="text-red-500">*</span>
                </label>
                <select
                  name="product_id"
                  required
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-white font-semibold outline-none focus:ring-1 focus:ring-green-500"
                >
                  <option value="">Select Product to Order</option>
                  {products?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.trade_name} (Stock Unit: {p.stock_unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">
                    Packages to Order (Count)
                  </label>
                  <input
                    type="number"
                    step="1"
                    name="packages_ordered"
                    defaultValue="1"
                    required
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">
                    Package Size (e.g. 5, 25)
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    name="package_size"
                    defaultValue="1"
                    required
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">
                    Estimated Unit Price (₹ / unit)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    name="unit_price"
                    defaultValue="0"
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-white outline-none focus:ring-1 focus:ring-green-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Link
              href="/dashboard/procurement/orders"
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
            >
              Save Draft PO
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
