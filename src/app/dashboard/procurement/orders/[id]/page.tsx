import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id
  const roles = (memberships?.roles || []) as string[]
  const isOwner = roles.includes('owner')
  const isProcurement = roles.includes('procurement')

  const [{ data: order }, { data: lines }, { data: receipts }] = await Promise.all([
    supabase
      .from('purchase_orders')
      .select('*, suppliers(*), profiles!created_by(full_name)')
      .eq('id', id)
      .eq('farm_id', farmId)
      .single(),
    supabase
      .from('purchase_order_lines')
      .select('*, product_catalog(*)')
      .eq('purchase_order_id', id)
      .eq('farm_id', farmId),
    supabase
      .from('goods_receipts')
      .select('*, product_catalog(trade_name), product_batches(batch_number), profiles!received_by(full_name)')
      .eq('purchase_order_id', id)
      .eq('farm_id', farmId)
      .order('received_date', { ascending: false }),
  ])

  if (!order) {
    notFound()
  }

  // Server Action: Owner approves PO
  async function approvePO() {
    'use server'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.roles?.includes('owner')) {
      await supabase
        .from('purchase_orders')
        .update({
          status: 'approved',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('farm_id', m.farm_id)

      revalidatePath(`/dashboard/procurement/orders/${id}`)
    }
  }

  // Server Action: Mark PO as Ordered with Supplier
  async function markAsOrdered() {
    'use server'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.farm_id && (m.roles.includes('owner') || m.roles.includes('procurement'))) {
      await supabase
        .from('purchase_orders')
        .update({
          status: 'ordered',
          ordered_date: new Date().toISOString().split('T')[0],
        })
        .eq('id', id)
        .eq('farm_id', m.farm_id)

      revalidatePath(`/dashboard/procurement/orders/${id}`)
    }
  }

  // Server Action: Receive Delivery against PO Line
  async function receiveGoods(formData: FormData) {
    'use server'
    const lineId = formData.get('line_id') as string
    const batchNumber = formData.get('batch_number') as string
    const qtyReceived = formData.get('quantity_received') ? parseFloat(formData.get('quantity_received') as string) : 0
    const mfgDate = (formData.get('mfg_date') as string) || null
    const expDate = (formData.get('expiry_date') as string) || null
    const location = (formData.get('storage_location') as string) || 'General Store'
    const invoiceRef = (formData.get('invoice_ref') as string) || null

    if (!lineId || !batchNumber?.trim() || qtyReceived <= 0) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (!m?.farm_id || (!m.roles.includes('owner') && !m.roles.includes('procurement'))) return

    // 1. Fetch Line item details
    const { data: line } = await supabase
      .from('purchase_order_lines')
      .select('*, product_catalog(stock_unit)')
      .eq('id', lineId)
      .eq('farm_id', m.farm_id)
      .single()

    if (!line) return

    // 2. Create or Find Batch
    const { data: batch, error: batchError } = await supabase
      .from('product_batches')
      .upsert({
        farm_id: m.farm_id,
        product_id: line.product_id,
        batch_number: batchNumber.trim(),
        supplier_id: order.supplier_id,
        manufacturing_date: mfgDate,
        expiry_date: expDate,
        initial_quantity: qtyReceived,
        quantity_unit: line.unit,
        storage_location: location.trim(),
        purchase_invoice_ref: invoiceRef?.trim() || order.po_number,
        status: 'available',
      }, { onConflict: 'farm_id,product_id,batch_number' })
      .select('id')
      .single()

    if (batchError || !batch) return

    // 3. Insert Append-Only Stock Movement
    await supabase.rpc('fn_record_stock_movement', {
      p_farm_id: m.farm_id,
      p_product_id: line.product_id,
      p_batch_id: batch.id,
      p_movement_type: 'purchase_receipt',
      p_quantity: qtyReceived,
      p_unit: line.unit,
      p_reference_type: 'purchase_order',
      p_reference_id: id,
      p_reason: `Received against PO ${order.po_number}`,
    })

    // 4. Record Goods Receipt
    await supabase.from('goods_receipts').insert({
      farm_id: m.farm_id,
      purchase_order_id: id,
      po_line_id: line.id,
      product_id: line.product_id,
      batch_id: batch.id,
      quantity_received: qtyReceived,
      unit: line.unit,
      received_by: user?.id,
      invoice_path: invoiceRef?.trim() || null,
    })

    // 5. Update Line Received Quantity
    const newTotalReceived = Number(line.quantity_received) + qtyReceived
    const isLineComplete = newTotalReceived >= Number(line.quantity_ordered)

    await supabase
      .from('purchase_order_lines')
      .update({
        quantity_received: newTotalReceived,
        status: isLineComplete ? 'received' : 'partially_received',
      })
      .eq('id', line.id)
      .eq('farm_id', m.farm_id)

    // 6. Update PO status
    await supabase
      .from('purchase_orders')
      .update({
        status: isLineComplete ? 'received' : 'partially_received',
      })
      .eq('id', id)
      .eq('farm_id', m.farm_id)

    revalidatePath(`/dashboard/procurement/orders/${id}`)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Purchase Order: ${order.po_number}`}
        description={`Supplier: ${order.suppliers?.name || 'Direct'} | Total: ${order.currency} ${Number(order.total_amount).toFixed(2)}`}
        actions={
          <div className="flex gap-2">
            <Link
              href="/dashboard/procurement/orders"
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md font-medium transition-colors"
            >
              ← Orders List
            </Link>

            {isOwner && order.status === 'draft' && (
              <form action={approvePO}>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-md shadow-xs transition-colors"
                >
                  ✓ Approve Purchase Order
                </button>
              </form>
            )}

            {(isOwner || isProcurement) && order.status === 'approved' && (
              <form action={markAsOrdered}>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-md shadow-xs transition-colors"
                >
                  Mark as Placed with Supplier
                </button>
              </form>
            )}
          </div>
        }
      />

      {/* Order Status Banner */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-6">
          <div>
            <span className="text-gray-400 block">Created On</span>
            <span className="font-semibold text-gray-800">{new Date(order.created_at).toLocaleDateString('en-IN')}</span>
          </div>
          <div>
            <span className="text-gray-400 block">Expected Delivery</span>
            <span className="font-semibold text-gray-800 font-mono">
              {order.expected_delivery_date ? new Date(order.expected_delivery_date).toLocaleDateString('en-IN') : 'Unspecified'}
            </span>
          </div>
          <div>
            <span className="text-gray-400 block">Supplier Contact</span>
            <span className="text-gray-700 font-medium">{order.suppliers?.phone || 'No phone'}</span>
          </div>
        </div>

        <StatusBadge status={order.status} />
      </div>

      {/* PO Line Items */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Ordered Products</h2>
          <span className="text-xs text-gray-500 font-mono">Lines: {lines?.length || 0}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-200 font-semibold">
              <tr>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3">Packages Ordered</th>
                <th className="px-4 py-3">Total Quantity</th>
                <th className="px-4 py-3">Est. Price</th>
                <th className="px-4 py-3">Received Progress</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs">
              {lines?.map((line) => {
                const ordered = Number(line.quantity_ordered)
                const received = Number(line.quantity_received)
                const pct = ordered > 0 ? Math.round((received / ordered) * 100) : 0

                return (
                  <tr key={line.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {line.product_catalog?.trade_name}
                      <span className="text-[11px] text-gray-400 block font-normal">
                        Package: {line.package_size} {line.unit}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-gray-800">
                      {line.packages_ordered} pkgs
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-gray-900">
                      {line.quantity_ordered} {line.unit}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700">
                      ₹ {line.total_price ? Number(line.total_price).toFixed(2) : '0.00'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-28 font-mono">
                        <span className="font-bold text-emerald-700">{received}</span> / {ordered} {line.unit} ({pct}%)
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={line.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Receive Goods Section (Partial or Full Delivery) */}
      {(isOwner || isProcurement) && order.status !== 'draft' && order.status !== 'cancelled' && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-xs p-6">
          <div className="border-b border-gray-100 pb-2 mb-4">
            <h3 className="text-base font-semibold text-gray-900">Record Physical Delivery (Goods Receipt)</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Receiving goods will create verified batches and immediately update the append-only inventory ledger.
            </p>
          </div>

          <form action={receiveGoods} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Select Product Line <span className="text-red-500">*</span>
                </label>
                <select
                  name="line_id"
                  required
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs bg-white font-medium outline-none focus:ring-1 focus:ring-green-500"
                >
                  <option value="">Select PO Line</option>
                  {lines?.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.product_catalog?.trade_name} (Remaining: {Number(l.quantity_ordered) - Number(l.quantity_received)} {l.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Batch / Lot Number on Box <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="batch_number"
                  placeholder="e.g. LOT-2026-NOV"
                  required
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs font-mono outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-900 mb-1">
                  Quantity Received Now <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.0001"
                  name="quantity_received"
                  placeholder="e.g. 5, 250"
                  required
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs font-bold font-mono outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Mfg Date (Optional)
                </label>
                <input
                  type="date"
                  name="mfg_date"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Expiry Date (FEFO)
                </label>
                <input
                  type="date"
                  name="expiry_date"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Storage Location
                </label>
                <input
                  type="text"
                  name="storage_location"
                  placeholder="e.g. Chemical Bay A"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Invoice / Challan Reference
                </label>
                <input
                  type="text"
                  name="invoice_ref"
                  placeholder="e.g. INV-9902"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded shadow-xs transition-colors"
              >
                + Confirm Goods Receipt & Update Ledger
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Receipts History */}
      {receipts && receipts.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-xs p-6">
          <h3 className="text-sm font-semibold text-gray-900 border-b border-gray-100 pb-2 mb-3">
            Recorded Goods Receipts for this Order
          </h3>
          <div className="divide-y divide-gray-100 text-xs">
            {receipts.map((r) => (
              <div key={r.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-gray-900">{r.product_catalog?.trade_name}</span>
                  <span className="text-gray-500 font-mono text-[11px] ml-2">
                    Batch: {r.product_batches?.batch_number} | Invoice: {r.invoice_path || 'N/A'}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono font-bold text-emerald-700">
                    +{r.quantity_received} {r.unit}
                  </span>
                  <span className="text-gray-400 font-mono text-[11px]">
                    {new Date(r.received_date).toLocaleDateString('en-IN')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

