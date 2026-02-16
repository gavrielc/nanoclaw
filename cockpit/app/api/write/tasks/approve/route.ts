import { authenticatedWrite } from '@/lib/write-handler';

export async function POST(request: Request) {
  return authenticatedWrite(request, '/ops/actions/approve');
}
