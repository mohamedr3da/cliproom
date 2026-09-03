import { addClip, jsonError, jsonOk, requireMember } from "@/lib/cliproom/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const member = await requireMember(request);
    return jsonOk(await addClip(member, await request.json()));
  } catch (error) {
    return jsonError(error);
  }
}
