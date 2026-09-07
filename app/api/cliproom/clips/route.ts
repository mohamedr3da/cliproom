import {
  addClip,
  assertMutationRequest,
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
    return jsonOk(await addClip(member, await readJson(request), wantsMutationResponse(request)));
  } catch (error) {
    return jsonError(error);
  }
}
