import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'

export default async function ProductDetailPage({
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
  const isAgronomist = roles.includes('agronomist')
  const isOwner = roles.includes('owner')

  const { data: product } = await supabase
    .from('product_catalog')
    .select('*, product_aliases(*), product_documents(*)')
    .eq('id', id)
    .eq('farm_id', farmId)
    .single()

  if (!product) {
    notFound()
  }

  // Server Action: Agronomist verifies product
  async function verifyProduct() {
    'use server'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.roles?.includes('agronomist')) {
      await supabase
        .from('product_catalog')
        .update({
          verification_status: 'verified',
          verified_by: user?.id,
          verified_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('farm_id', m.farm_id)

      revalidatePath(`/dashboard/products/${id}`)
    }
  }

  // Server Action: Add alias
  async function addAlias(formData: FormData) {
    'use server'
    const aliasName = formData.get('alias_name') as string
    const aliasType = (formData.get('alias_type') as string) || 'commercial'
    const notes = formData.get('notes') as string

    if (!aliasName?.trim()) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.farm_id && (m.roles.includes('owner') || m.roles.includes('agronomist'))) {
      await supabase.from('product_aliases').insert({
        farm_id: m.farm_id,
        product_id: id,
        alias_name: aliasName.trim(),
        alias_type: aliasType,
        notes: notes?.trim() || null,
      })
      revalidatePath(`/dashboard/products/${id}`)
    }
  }

  // Server Action: Delete alias
  async function deleteAlias(formData: FormData) {
    'use server'
    const aliasId = formData.get('alias_id') as string
    if (!aliasId) return

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: m } = await supabase
      .from('farm_memberships')
      .select('farm_id, roles')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .single()

    if (m?.farm_id && (m.roles.includes('owner') || m.roles.includes('agronomist'))) {
      await supabase
        .from('product_aliases')
        .delete()
        .eq('id', aliasId)
        .eq('farm_id', m.farm_id)

      revalidatePath(`/dashboard/products/${id}`)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title={product.trade_name}
        description={`Category: ${product.category.toUpperCase()} | Brand: ${product.brand || 'N/A'}`}
        actions={
          <Link
            href="/dashboard/products"
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md font-medium transition-colors"
          >
            ← Back to Catalogue
          </Link>
        }
      />

      {/* Verification Status Alert */}
      {product.verification_status !== 'verified' ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              <h3 className="text-sm font-bold text-amber-900">Unverified Agricultural Input</h3>
            </div>
            <p className="text-xs text-amber-700 mt-1">
              According to safety rules, unverified products cannot be released into supervisor work orders until an agronomist confirms chemical composition and dosage safety.
            </p>
          </div>
          {isAgronomist && (
            <form action={verifyProduct}>
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-md shadow-xs whitespace-nowrap transition-colors"
              >
                ✓ Verify & Approve Product
              </button>
            </form>
          )}
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center justify-between text-xs text-emerald-800">
          <div className="flex items-center gap-2">
            <span className="text-lg">✓</span>
            <span className="font-semibold">Identity Verified & Approved for Treatment Work Orders</span>
          </div>
          {product.verified_at && (
            <span className="font-mono text-emerald-700">
              Verified on: {new Date(product.verified_at).toLocaleDateString('en-IN')}
            </span>
          )}
        </div>
      )}

      {/* Product Information Card */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Technical Specifications</h2>
          <StatusBadge status={product.verification_status} />
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <div>
            <span className="text-xs text-gray-400 block font-medium">Active Ingredient</span>
            <span className="font-semibold text-gray-900 block mt-0.5">
              {product.active_ingredient || 'Not specified'}
            </span>
          </div>

          <div>
            <span className="text-xs text-gray-400 block font-medium">Concentration / Strength</span>
            <span className="font-semibold text-gray-900 block mt-0.5 font-mono">
              {product.concentration || 'Not specified'}
            </span>
          </div>

          <div>
            <span className="text-xs text-gray-400 block font-medium">Formulation Grade</span>
            <span className="font-semibold text-gray-900 block mt-0.5">
              {product.formulation || 'Not specified'}
            </span>
          </div>

          <div>
            <span className="text-xs text-gray-400 block font-medium">Manufacturer</span>
            <span className="text-gray-800 block mt-0.5">{product.manufacturer || 'N/A'}</span>
          </div>

          <div>
            <span className="text-xs text-gray-400 block font-medium">Standard Packaging</span>
            <span className="text-gray-800 block mt-0.5 font-mono">
              {product.standard_package_size ? `${product.standard_package_size} ${product.package_unit || ''}` : 'N/A'}
            </span>
          </div>

          <div>
            <span className="text-xs text-gray-400 block font-medium">Stock / Ledger Unit</span>
            <span className="font-bold text-gray-900 block mt-0.5 font-mono text-base">
              {product.stock_unit}
            </span>
          </div>

          <div className="md:col-span-3 pt-3 border-t border-gray-100">
            <span className="text-xs text-gray-400 block font-medium">Approved Target Crops / Pests</span>
            <p className="text-xs text-gray-700 mt-1">{product.target_crops_pests || 'None listed'}</p>
          </div>

          {product.storage_instructions && (
            <div className="md:col-span-3 pt-2">
              <span className="text-xs text-gray-400 block font-medium">Storage Instructions</span>
              <p className="text-xs text-gray-600 mt-1">{product.storage_instructions}</p>
            </div>
          )}
        </div>
      </div>

      {/* Aliases Section */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-xs p-6">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Canonical Product Aliases</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Map handwritten spellings, local slangs, and supplier names to this canonical product.
            </p>
          </div>
          <span className="text-xs text-gray-500 font-mono">Total: {product.product_aliases?.length || 0}</span>
        </div>

        {/* Existing Aliases */}
        {product.product_aliases && product.product_aliases.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            {product.product_aliases.map((alias: { id: string; alias_name: string; alias_type: string; notes: string | null }) => (
              <div
                key={alias.id}
                className="bg-gray-50 border border-gray-200 rounded-md p-3 flex items-start justify-between gap-2"
              >
                <div>
                  <span className="font-semibold text-gray-900 text-sm block">{alias.alias_name}</span>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider font-mono">
                    Type: {alias.alias_type}
                  </span>
                  {alias.notes && <p className="text-[11px] text-gray-600 mt-1">{alias.notes}</p>}
                </div>
                {(isOwner || isAgronomist) && (
                  <form action={deleteAlias}>
                    <input type="hidden" name="alias_id" value={alias.id} />
                    <button
                      type="submit"
                      className="text-gray-400 hover:text-red-600 text-xs px-1"
                      title="Remove alias"
                    >
                      ✕
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic mb-6">No aliases registered for this product.</p>
        )}

        {/* Add Alias Form */}
        {(isOwner || isAgronomist) && (
          <form action={addAlias} className="bg-gray-50/70 p-4 rounded-lg border border-gray-200">
            <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-3">Add New Alias</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <input
                  type="text"
                  name="alias_name"
                  placeholder="Alias name (e.g. Confidor, Imida)"
                  required
                  className="w-full px-3 py-1.5 bg-white border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div>
                <select
                  name="alias_type"
                  className="w-full px-3 py-1.5 bg-white border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
                >
                  <option value="commercial">Commercial Name</option>
                  <option value="handwritten">Handwritten Spelling</option>
                  <option value="supplier">Supplier Name</option>
                  <option value="agronomist">Agronomist Shorthand</option>
                  <option value="local_language">Local Language Name</option>
                </select>
              </div>

              <div>
                <input
                  type="text"
                  name="notes"
                  placeholder="Context notes (optional)"
                  className="w-full px-3 py-1.5 bg-white border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
            </div>

            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                className="px-4 py-1.5 bg-gray-800 hover:bg-gray-900 text-white text-xs font-medium rounded transition-colors"
              >
                + Register Alias
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

