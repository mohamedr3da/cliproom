import { getRoomState, jsonError, jsonOk, requireMember } from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const member = await requireMember(request);
    return jsonOk(await getRoomState(member));
  } catch (error) {
    return jsonError(error);
  }
}
