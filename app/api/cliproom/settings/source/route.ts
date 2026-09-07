import {
  assertMutationRequest,
  jsonError,
  jsonOk,
  readJson,
  requireMember,
  setSourceChannel,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    assertMutationRequest(request);
    const member = await requireMember(request);
    const { channel, trustedClippers } = await readJson<{
      channel?: unknown;
      trustedClippers?: unknown;
    }>(request, 16_384);
    return jsonOk(await setSourceChannel(member, channel, trustedClippers));
  } catch (error) {
    return jsonError(error);
  }
}
