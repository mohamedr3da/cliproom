import {
  assertMutationRequest,
  createCollection,
  jsonError,
  jsonOk,
  readJson,
  requireMember,
  wantsMutationResponse,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertMutationRequest(request);
    const member = await requireMember(request);
    return jsonOk(
      await createCollection(
        member,
        await readJson<{
          title?: unknown;
          notes?: unknown;
          category?: unknown;
          urls?: unknown;
        }>(request, 131_072),
        wantsMutationResponse(request),
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
