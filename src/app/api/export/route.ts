import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const reportType = searchParams.get('type')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!memberships?.farm_id) {
    return NextResponse.json({ error: 'No active farm membership' }, { status: 403 })
  }

  const farmId = memberships.farm_id
  let csvContent = ''
  let filename = `smartfarm-${reportType || 'report'}-${new Date().toISOString().split('T')[0]}.csv`

  if (reportType === 'inventory') {
    const { data: items } = await supabase
      .from('v_stock_balances')
      .select('*')
      .eq('farm_id', farmId)
      .order('trade_name', { ascending: true })

    const headers = ['Product Name', 'Category', 'Active Ingredient', 'Batch Number', 'Current Balance', 'Unit', 'Expiry Date', 'Status', 'Storage Location']
    const rows = (items || []).map((i) => [
      `"${i.trade_name || ''}"`,
      `"${i.category || ''}"`,
      `"${i.active_ingredient || ''}"`,
      `"${i.batch_number || ''}"`,
      i.current_balance,
      i.unit,
      i.expiry_date || 'N/A',
      i.batch_status,
      `"${i.storage_location || ''}"`,
    ])
    csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')

  } else if (reportType === 'movements') {
    const { data: movements } = await supabase
      .from('stock_movements')
      .select('*, product_catalog(trade_name), product_batches(batch_number), profiles!performed_by(full_name)')
      .eq('farm_id', farmId)
      .order('movement_date', { ascending: false })

    const headers = ['Timestamp', 'Product Name', 'Batch Number', 'Movement Type', 'Quantity', 'Unit', 'Operator', 'Reason']
    const rows = (movements || []).map((m) => [
      `"${new Date(m.movement_date).toLocaleString('en-IN')}"`,
      `"${m.product_catalog?.trade_name || ''}"`,
      `"${m.product_batches?.batch_number || ''}"`,
      m.movement_type,
      m.quantity,
      m.unit,
      `"${m.profiles?.full_name || ''}"`,
      `"${(m.reason || '').replace(/"/g, '""')}"`,
    ])
    csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')

  } else if (reportType === 'applications') {
    const { data: apps } = await supabase
      .from('application_records')
      .select('*, product_catalog(trade_name), product_batches(batch_number), profiles!operator_id(full_name), work_orders(houses(name))')
      .eq('farm_id', farmId)
      .order('application_date', { ascending: false })

    const headers = ['Date', 'Product', 'Batch', 'Polyhouse', 'Planned Qty', 'Actual Qty', 'Unit', 'Stock Issued', 'Stock Returned', 'Operator', 'Verification Status', 'Deviations']
    const rows = (apps || []).map((a) => [
      a.application_date,
      `"${a.product_catalog?.trade_name || ''}"`,
      `"${a.product_batches?.batch_number || ''}"`,
      `"${a.work_orders?.houses?.name || ''}"`,
      a.planned_quantity,
      a.actual_quantity,
      a.quantity_unit,
      a.stock_issued,
      a.stock_returned,
      `"${a.profiles?.full_name || ''}"`,
      a.verification_status,
      `"${(a.deviations || '').replace(/"/g, '""')}"`,
    ])
    csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')

  } else if (reportType === 'crop_health') {
    const { data: obs } = await supabase
      .from('crop_observations')
      .select('*, scouting_rounds(scouting_date, houses(name), crop_cycles(crop_name))')
      .eq('farm_id', farmId)
      .order('created_at', { ascending: false })

    const headers = ['Date', 'Polyhouse', 'Crop', 'Suspected Issue', 'Plants Checked', 'Plants Affected', 'Incidence (%)', 'Severity', 'Response vs Previous', 'Resolved']
    const rows = (obs || []).map((o) => [
      o.scouting_rounds?.scouting_date || '',
      `"${o.scouting_rounds?.houses?.name || ''}"`,
      `"${o.scouting_rounds?.crop_cycles?.crop_name || ''}"`,
      `"${(o.suspected_issue || '').replace(/"/g, '""')}"`,
      o.plants_checked,
      o.plants_affected,
      o.incidence_pct,
      o.severity,
      o.response_vs_previous || 'N/A',
      o.is_resolved ? 'Yes' : 'No',
    ])
    csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')

  } else {
    return NextResponse.json({ error: 'Invalid report type' }, { status: 400 })
  }

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

