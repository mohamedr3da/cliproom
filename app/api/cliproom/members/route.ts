import { createInvite, jsonError, jsonOk, requireMember } from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const member = await requireMember(request);
    return jsonOk(await createInvite(request, member, await request.json()));
  } catch (error) {
    return jsonError(error);
  }
}
