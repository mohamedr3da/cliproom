import {
  beginTwitchAuth,
  jsonError,
  jsonOk,
  readJson,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { authorizationUrl, cookie } = await beginTwitchAuth(
      request,
      await readJson<{ setupCode?: unknown }>(request, 4096),
    );
    return jsonOk({ authorizationUrl }, { headers: { "Set-Cookie": cookie } });
  } catch (error) {
    return jsonError(error);
  }
}
