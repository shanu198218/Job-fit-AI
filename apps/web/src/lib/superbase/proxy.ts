
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Update cookies on the incoming request.
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          // Rebuild the response with the updated request.
          supabaseResponse = NextResponse.next({
            request,
          });

          // Send updated cookies to the browser.
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });

          // Apply Supabase cache-prevention headers.
          Object.entries(headers).forEach(([key, value]) => {
            supabaseResponse.headers.set(key, value);
          });
        },
      },
    }
  );

  // Verify the user's JWT and refresh the session if necessary.
  const { error } = await supabase.auth.getClaims();
  if (error) {
    console.error("[supabase] DB/auth connection check failed:", error.message);
  } else {
    console.log("[supabase] DB connected successfully.");
  }

  return supabaseResponse;
}
