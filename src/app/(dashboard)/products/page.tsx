import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import Link from 'next/link'
import { PRODUCT_CATEGORIES } from '@/types/enums'

interface SearchParams {
  category?: string
  q?: string
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { category, q } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('farm_memberships')
    .select('farm_id, roles')
    .eq('user_id', user?.id)
    .eq('status', 'active')
    .single()

  const farmId = memberships?.farm_id
  const canAddProduct = memberships?.roles?.some((r: string) => ['owner', 'agronomist'].includes(r))

  let query = supabase
    .from('product_catalog')
    .select('*, product_aliases(alias_name)')
    .eq('farm_id', farmId)
    .eq('is_archived', false)
    .order('trade_name', { ascending: true })

  if (category) {
    query = query.eq('category', category)
  }

  if (q?.trim()) {
    query = query.or(`trade_name.ilike.%${q.trim()}%,active_ingredient.ilike.%${q.trim()}%,brand.ilike.%${q.trim()}%`)
  }

  const { data: products } = await query

  return (
    <div>
      <PageHeader
        title="Product Master Catalogue"
        description="Verified agricultural inputs, compositions, package sizes, and canonical alias mappings"
        actions={
          canAddProduct && (
            <Link
              href="/dashboard/products/new"
              className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors"
            >
              + Add Product
            </Link>
          )
        }
      />

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 mb-6 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <form method="GET" className="flex flex-1 flex-col sm:flex-row gap-3 w-full">
          <input
            type="text"
            name="q"
            defaultValue={q || ''}
            placeholder="Search by trade name, active ingredient, brand..."
            className="px-3 py-2 border border-gray-300 rounded-md text-sm flex-1 outline-none focus:ring-2 focus:ring-green-500"
          />

          <select
            name="category"
            defaultValue={category || ''}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="">All Categories</option>
            {Object.values(PRODUCT_CATEGORIES).map((cat) => (
              <option key={cat} value={cat}>
                {cat.replace(/_/g, ' ').toUpperCase()}
              </option>
            ))}
          </select>

          <button
            type="submit"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium rounded-md transition-colors"
          >
            Filter
          </button>
        </form>
      </div>

      {/* Products Table */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
        {!products || products.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <span className="text-3xl block mb-2">🧪</span>
            <p className="font-medium text-gray-700">No agricultural products found.</p>
            <p className="text-xs text-gray-400 mt-1">Register products in the master catalogue before planning treatments.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-200 font-semibold">
                <tr>
                  <th className="px-4 py-3">Trade Name & Brand</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Active Ingredient & Formulation</th>
                  <th className="px-4 py-3">Standard Pack</th>
                  <th className="px-4 py-3">Stock Unit</th>
                  <th className="px-4 py-3">Verification</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/products/${p.id}`}
                        className="font-semibold text-green-700 hover:text-green-800 block"
                      >
                        {p.trade_name}
                      </Link>
                      {p.brand && <span className="text-xs text-gray-500 block">{p.brand}</span>}
                      {p.product_aliases && p.product_aliases.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {p.product_aliases.map((a: { alias_name: string }) => (
                            <span
                              key={a.alias_name}
                              className="inline-block px-1.5 py-0.2 rounded text-[10px] bg-gray-100 text-gray-600 font-mono"
                            >
                              aka: {a.alias_name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                        {p.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="text-gray-900 font-medium block">
                        {p.active_ingredient || 'Not specified'}
                      </span>
                      <span className="text-gray-500 text-[11px] font-mono">
                        {p.concentration ? `${p.concentration} ` : ''}
                        {p.formulation ? `(${p.formulation})` : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-700">
                      {p.standard_package_size ? `${p.standard_package_size} ${p.package_unit || ''}` : 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono font-bold text-gray-800">
                      {p.stock_unit}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.verification_status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/products/${p.id}`}
                        className="text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
