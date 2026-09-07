import {
  assertMutationRequest,
  jsonError,
  jsonOk,
  readJson,
  removeCollectionClip,
  reorderCollectionClip,
  requireMember,
  wantsMutationResponse,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; clipId: string }> | { id: string; clipId: string };
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertMutationRequest(request);
    const member = await requireMember(request);
    const params = await context.params;
    const { direction } = await readJson<{ direction?: unknown }>(request, 4096);
    return jsonOk(
      await reorderCollectionClip(member, params.id, params.clipId, direction, wantsMutationResponse(request)),
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertMutationRequest(request);
    const member = await requireMember(request);
    const params = await context.params;
    return jsonOk(await removeCollectionClip(member, params.id, params.clipId, wantsMutationResponse(request)));
  } catch (error) {
    return jsonError(error);
  }
}
