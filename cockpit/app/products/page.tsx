import Link from 'next/link';
import { opsFetch } from '@/lib/ops-fetch';
import { Badge } from '@/components/Badge';
import { ErrorCallout } from '@/components/ErrorCallout';

interface Product {
  id: string;
  name: string;
  status: string;
  risk_level: string;
  created_at: string;
  updated_at: string;
}

export default async function ProductsPage() {
  let products: Product[];
  try {
    products = await opsFetch<Product[]>('/ops/products');
  } catch (err) {
    return (
      <ErrorCallout
        message={
          err instanceof Error ? err.message : 'Failed to load products'
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Products</h2>

      {products.length === 0 ? (
        <p className="text-sm text-zinc-500">No products registered</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <Link
              key={p.id}
              href={`/products/${p.id}`}
              className="rounded border border-zinc-800 bg-zinc-950 p-4 hover:border-zinc-600"
            >
              <div className="mb-2 font-semibold">{p.name}</div>
              <div className="flex gap-2">
                <Badge value={p.status} />
                <span className="text-xs text-zinc-500">
                  Risk: {p.risk_level}
                </span>
              </div>
              <div className="mt-2 text-xs text-zinc-600">
                Created: {p.created_at}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
