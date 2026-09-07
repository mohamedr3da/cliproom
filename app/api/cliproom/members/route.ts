import {
  addMember,
  assertMutationRequest,
  jsonError,
  jsonOk,
  readJson,
  requireMember,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertMutationRequest(request);
    const member = await requireMember(request);
    return jsonOk(
      await addMember(
        member,
        await readJson<{ username?: unknown; role?: unknown }>(request, 4096),
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
