import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTodaysOrders } from "@/lib/orders";
import config from "@/config.json";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("admin_session");

  if (!session || session.value !== process.env.ADMIN_PASSWORD) {
    redirect("/admin/login");
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  const orders = await getTodaysOrders(phoneNumberId);
  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Karachi",
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-orange-600 text-white px-6 py-4 shadow">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">{config.business.name} — Orders</h1>
            <p className="text-orange-200 text-sm mt-0.5">{today}</p>
          </div>
          <a
            href="/admin"
            className="bg-orange-500 hover:bg-orange-400 px-4 py-2 rounded text-sm font-medium transition-colors"
          >
            Refresh
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-3">
          <div className="bg-white rounded-lg p-5 shadow-sm border">
            <p className="text-gray-500 text-sm">Orders Today</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{orders.length}</p>
          </div>
          <div className="bg-white rounded-lg p-5 shadow-sm border">
            <p className="text-gray-500 text-sm">Revenue Today</p>
            <p className="text-3xl font-bold text-green-600 mt-1">
              Rs. {totalRevenue.toLocaleString()}
            </p>
          </div>
          <div className="bg-white rounded-lg p-5 shadow-sm border col-span-2 sm:col-span-1">
            <p className="text-gray-500 text-sm">Avg. Order Value</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">
              Rs. {orders.length ? Math.round(totalRevenue / orders.length).toLocaleString() : 0}
            </p>
          </div>
        </div>

        {orders.length === 0 ? (
          <div className="text-center py-20 text-gray-400 bg-white rounded-lg border shadow-sm">
            <p className="text-4xl mb-3">🍽️</p>
            <p className="text-lg font-medium">No orders yet today</p>
            <p className="text-sm mt-1">Orders will appear here as they come in</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">
                    Order ID
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">
                    Time
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">
                    Phone
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Items</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">
                    Total
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...orders].reverse().map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">
                      {order.id}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {new Date(order.timestamp).toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Karachi",
                      })}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {order.phone}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <ul className="space-y-0.5">
                        {order.items.map((item, i) => (
                          <li key={i}>
                            {item.name}{" "}
                            <span className="text-gray-400">×{item.qty}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-800 text-right whitespace-nowrap">
                      Rs. {order.total.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs">
                      <span className="line-clamp-2">{order.address}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
