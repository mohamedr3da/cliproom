import {
  assertMutationRequest,
  destroyCurrentSession,
  getAuthStatus,
  jsonError,
  jsonOk,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return jsonOk(await getAuthStatus(request));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertMutationRequest(request);
    const cookie = await destroyCurrentSession(request);
    return jsonOk({ ok: true }, { headers: { "Set-Cookie": cookie } });
  } catch (error) {
    return jsonError(error);
  }
}
