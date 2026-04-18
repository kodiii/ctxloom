export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-red-50 border border-red-200 p-4 text-red-800 text-sm">
      {message}
    </div>
  );
}
