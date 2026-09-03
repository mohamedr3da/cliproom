import {
  advanceClip,
  deleteClip,
  jsonError,
  jsonOk,
  requireMember,
  toggleClipPriority,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

async function getClipId(context: RouteContext) {
  const params = await context.params;
  return params.id;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const member = await requireMember(request);
    const { action } = (await request.json()) as { action?: string };
    const clipId = await getClipId(context);

    if (action === "advance") {
      return jsonOk(await advanceClip(member, clipId));
    }

    if (action === "togglePriority") {
      return jsonOk(await toggleClipPriority(member, clipId));
    }

    return jsonOk(await advanceClip(member, clipId));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const member = await requireMember(request);
    return jsonOk(await deleteClip(member, await getClipId(context)));
  } catch (error) {
    return jsonError(error);
  }
}
