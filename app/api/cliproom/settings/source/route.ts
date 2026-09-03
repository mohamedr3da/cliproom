import {
  jsonError,
  jsonOk,
  requireMember,
  setSourceChannel,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const member = await requireMember(request);
    const { channel, trustedClippers } = (await request.json()) as {
      channel?: unknown;
      trustedClippers?: unknown;
    };
    return jsonOk(await setSourceChannel(member, channel, trustedClippers));
  } catch (error) {
    return jsonError(error);
  }
}
