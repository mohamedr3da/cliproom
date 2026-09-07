import {
  assertMutationRequest,
  jsonError,
  jsonOk,
  requireMember,
  syncTwitchClips,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertMutationRequest(request);
    const member = await requireMember(request);
    return jsonOk(await syncTwitchClips(member));
  } catch (error) {
    return jsonError(error);
  }
}
