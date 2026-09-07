import { getAuditLogs, jsonError, jsonOk, requireMember } from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const member = await requireMember(request);
    const limit = new URL(request.url).searchParams.get("limit");
    return jsonOk(await getAuditLogs(member, limit));
  } catch (error) {
    return jsonError(error);
  }
}
