import type { Metadata } from 'next';
import { Sidebar } from '@/components/Sidebar';
import { LogoutButton } from '@/components/LogoutButton';
import './globals.css';

export const metadata: Metadata = {
  title: 'NanoClaw Cockpit',
  description: 'Operational dashboard for NanoClaw OS',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="flex h-screen bg-zinc-900 text-zinc-100">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex items-center justify-end border-b border-zinc-800 px-6 py-2">
            <LogoutButton />
          </header>
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
