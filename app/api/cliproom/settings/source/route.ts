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
    const { channel } = (await request.json()) as { channel?: unknown };
    return jsonOk(await setSourceChannel(member, channel));
  } catch (error) {
    return jsonError(error);
  }
}
