import {
  authErrorCode,
  completeTwitchAuth,
  expiredOauthCookie,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

function redirect(request: Request, location: string, cookies: string[]) {
  const headers = new Headers({ Location: new URL(location, request.url).toString() });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "same-origin");
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("error")) {
      return redirect(request, "/?auth_error=cancelled", [expiredOauthCookie(request)]);
    }

    const { cookie, oauthCookie } = await completeTwitchAuth(request);
    return redirect(request, "/", [cookie, oauthCookie]);
  } catch (error) {
    return redirect(request, `/?auth_error=${encodeURIComponent(authErrorCode(error))}`, [
      expiredOauthCookie(request),
    ]);
  }
}
