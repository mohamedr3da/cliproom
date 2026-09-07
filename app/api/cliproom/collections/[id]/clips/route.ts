import {
  addCollectionClip,
  assertMutationRequest,
  jsonError,
  jsonOk,
  readJson,
  requireMember,
  wantsMutationResponse,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

export async function POST(request: Request, context: RouteContext) {
  try {
    assertMutationRequest(request);
    const member = await requireMember(request);
    const params = await context.params;
    return jsonOk(
      await addCollectionClip(
        member,
        params.id,
        await readJson<{ url?: unknown }>(request, 4096),
        wantsMutationResponse(request),
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
