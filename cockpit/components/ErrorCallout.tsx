export function ErrorCallout({ message }: { message: string }) {
  return (
    <div className="rounded border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
      <span className="font-semibold">Error: </span>
      {message}
    </div>
  );
}
