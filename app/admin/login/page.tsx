export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md w-96">
        <h1 className="text-2xl font-bold mb-2 text-gray-800">Admin Login</h1>
        <p className="text-gray-500 text-sm mb-6">Karachi Biryani House</p>
        {error && (
          <p className="text-red-500 text-sm mb-4 bg-red-50 border border-red-200 rounded px-3 py-2">
            Incorrect password. Try again.
          </p>
        )}
        <form action="/api/admin/login" method="POST" className="space-y-4">
          <input
            type="password"
            name="password"
            placeholder="Admin password"
            autoFocus
            required
            className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <button
            type="submit"
            className="w-full bg-orange-500 text-white py-2 rounded font-semibold hover:bg-orange-600 transition-colors"
          >
            Login
          </button>
        </form>
      </div>
    </div>
  );
}
