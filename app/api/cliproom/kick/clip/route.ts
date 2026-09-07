import {
  assertMutationRequest,
  getKickClipPlayback,
  HttpError,
  jsonError,
  jsonOk,
  readJson,
  requireMember,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertMutationRequest(request);
    await requireMember(request);
    const input = await readJson<{ clipId?: unknown }>(request, 4096);
    if (typeof input.clipId !== "string" || !input.clipId.trim()) {
      throw new HttpError(400, "A clip ID is required.");
    }
    return jsonOk(await getKickClipPlayback(input.clipId.trim()));
  } catch (error) {
    return jsonError(error);
  }
}
