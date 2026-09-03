import { jsonError, jsonOk, removeMember, requireMember } from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const member = await requireMember(request);
    const params = await context.params;
    return jsonOk(await removeMember(member, params.id));
  } catch (error) {
    return jsonError(error);
  }
}
