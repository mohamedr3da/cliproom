import {
  jsonError,
  jsonOk,
  regenerateInvite,
  requireMember,
} from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

export async function POST(request: Request, context: RouteContext) {
  try {
    const member = await requireMember(request);
    const params = await context.params;
    return jsonOk(await regenerateInvite(request, member, params.id));
  } catch (error) {
    return jsonError(error);
  }
}
