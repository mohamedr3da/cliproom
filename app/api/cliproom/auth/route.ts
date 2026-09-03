import {
  destroyCurrentSession,
  jsonError,
  jsonOk,
  signInWithCode,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { state, cookie } = await signInWithCode(request, await request.json());
    return jsonOk(state, { headers: { "Set-Cookie": cookie } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const cookie = await destroyCurrentSession(request);
    return jsonOk({ ok: true }, { headers: { "Set-Cookie": cookie } });
  } catch (error) {
    return jsonError(error);
  }
}
