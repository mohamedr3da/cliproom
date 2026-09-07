import {
  advanceClip,
  assertMutationRequest,
  deleteClip,
  HttpError,
  jsonError,
  jsonOk,
  permanentlyDeleteClip,
  readJson,
  requireMember,
  resetClipProgress,
  restoreClip,
  toggleClipPriority,
  updateClipDetails,
  wantsMutationResponse,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

async function getClipId(context: RouteContext) {
  const params = await context.params;
  return params.id;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertMutationRequest(request);
    const member = await requireMember(request);
    const input = await readJson<{
      action?: string;
      title?: unknown;
      notes?: unknown;
      category?: unknown;
    }>(request, 4096);
    const clipId = await getClipId(context);
    const compact = wantsMutationResponse(request);
    if (input.action === "permanent-delete") return jsonOk(await permanentlyDeleteClip(member, clipId, compact));
    if (input.action === "restore") return jsonOk(await restoreClip(member, clipId, compact));
    if (input.action === "resetProgress") return jsonOk(await resetClipProgress(member, clipId, compact));
    if (input.action === "advance") return jsonOk(await advanceClip(member, clipId, compact));
    if (input.action === "togglePriority") return jsonOk(await toggleClipPriority(member, clipId, compact));
    if (input.action === "updateDetails") return jsonOk(await updateClipDetails(member, clipId, input, compact));
    throw new HttpError(400, "That clip action is not supported.");
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertMutationRequest(request);
    const member = await requireMember(request);
    return jsonOk(await deleteClip(member, await getClipId(context), wantsMutationResponse(request)));
  } catch (error) {
    return jsonError(error);
  }
}
