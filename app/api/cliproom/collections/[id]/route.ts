import {
  advanceCollection,
  assertMutationRequest,
  deleteCollection,
  HttpError,
  jsonError,
  jsonOk,
  permanentlyDeleteCollection,
  readJson,
  requireMember,
  resetCollectionProgress,
  restoreCollection,
  toggleCollectionPriority,
  toggleCollectionSaved,
  updateCollection,
  wantsMutationResponse,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

async function getCollectionId(context: RouteContext) {
  const params = await context.params;
  return params.id;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertMutationRequest(request);
    const member = await requireMember(request);
    const input = await readJson<{
      action?: unknown;
      title?: unknown;
      notes?: unknown;
      category?: unknown;
    }>(request, 16_384);
    const collectionId = await getCollectionId(context);
    const compact = wantsMutationResponse(request);
    if (input.action === "permanent-delete") {
      return jsonOk(await permanentlyDeleteCollection(member, collectionId, compact));
    }
    if (input.action === "restore") {
      return jsonOk(await restoreCollection(member, collectionId, compact));
    }
    if (input.action === "resetProgress") {
      return jsonOk(await resetCollectionProgress(member, collectionId, compact));
    }
    if (input.action === "advance") {
      return jsonOk(await advanceCollection(member, collectionId, compact));
    }
    if (input.action === "togglePriority") {
      return jsonOk(await toggleCollectionPriority(member, collectionId, compact));
    }
    if (input.action === "toggleSaved") {
      return jsonOk(await toggleCollectionSaved(member, collectionId, compact));
    }
    if (input.action === "update") {
      return jsonOk(await updateCollection(member, collectionId, input, compact));
    }
    throw new HttpError(400, "That Collection action is not supported.");
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertMutationRequest(request);
    const member = await requireMember(request);
    return jsonOk(await deleteCollection(member, await getCollectionId(context), wantsMutationResponse(request)));
  } catch (error) {
    return jsonError(error);
  }
}
