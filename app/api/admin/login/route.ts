import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = formData.get("password") as string;

  if (password && password === process.env.ADMIN_PASSWORD) {
    const cookieStore = await cookies();
    cookieStore.set("admin_session", password, {
      httpOnly: true,
      maxAge: 60 * 60 * 24,
      sameSite: "lax",
      path: "/",
    });
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return NextResponse.redirect(new URL("/admin/login?error=1", request.url));
}
