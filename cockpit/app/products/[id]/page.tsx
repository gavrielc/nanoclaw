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

interface Task {
  id: string;
  title: string;
  state: string;
  priority: string;
  task_type: string;
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let product: Product;
  let tasks: Task[];

  try {
    product = await opsFetch<Product>(
      `/ops/products/${encodeURIComponent(id)}`,
    );
  } catch (err) {
    return (
      <ErrorCallout
        message={
          err instanceof Error ? err.message : 'Failed to load product'
        }
      />
    );
  }

  try {
    tasks = await opsFetch<Task[]>('/ops/tasks', { product_id: id });
  } catch {
    tasks = [];
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/products"
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          &larr; Products
        </Link>
        <h2 className="mt-1 text-xl font-bold">{product.name}</h2>
      </div>

      <div className="flex gap-4 text-sm">
        <div>
          <span className="text-zinc-500">Status: </span>
          <Badge value={product.status} />
        </div>
        <div>
          <span className="text-zinc-500">Risk: </span>
          {product.risk_level}
        </div>
        <div className="text-zinc-500">Created: {product.created_at}</div>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-400">
          Tasks ({tasks.length})
        </h3>
        {tasks.length === 0 ? (
          <p className="text-sm text-zinc-500">No tasks for this product</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="pb-2">Title</th>
                <th className="pb-2">State</th>
                <th className="pb-2">Priority</th>
                <th className="pb-2">Type</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                >
                  <td className="py-2">
                    <Link
                      href={`/tasks/${t.id}`}
                      className="text-blue-400 hover:underline"
                    >
                      {t.title}
                    </Link>
                  </td>
                  <td className="py-2">
                    <Badge value={t.state} />
                  </td>
                  <td className="py-2">
                    <Badge value={t.priority} />
                  </td>
                  <td className="py-2 text-zinc-400">{t.task_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
