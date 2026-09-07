import { categories } from "@/lib/cliproom/shared";
import type { Category, ClipStatus } from "@/lib/cliproom/shared";
import { formatUserDate } from "@/components/cliproom/date-format";

export const statusStyles: Record<ClipStatus, string> = {
  New: "border-[#2dd4bf]/45 bg-[#2dd4bf]/12 text-[#b9fff7]",
  Prioritised: "border-[#facc15]/45 bg-[#facc15]/12 text-[#fff4b0]",
  Claimed: "border-white/16 bg-white/8 text-white/72",
  Editing: "border-[#9146ff]/45 bg-[#9146ff]/14 text-[#e1d2ff]",
  Posted: "border-[#6ee7b7]/45 bg-[#6ee7b7]/12 text-[#c8ffe6]",
};

export function formatTaskDate(value: string | null) {
  return formatUserDate(value);
}

export function categoryLabel(category: Category) {
  return categories.find((item) => item.id === category)?.label ?? "Other";
}

export function taskActionLabel(
  task: { status: ClipStatus; assignee: string },
  currentUsername: string,
  isAdmin: boolean,
) {
  const claimedByOther =
    task.assignee !== "Unclaimed" && task.assignee !== currentUsername && !isAdmin;
  if (task.status === "Posted") return "Posted";
  if (claimedByOther) return "Claimed";
  if (task.status === "New" || task.status === "Prioritised") return "Claim";
  if (task.status === "Claimed") return "Start edit";
  return "Mark posted";
}

export function canAdvanceTask(
  task: { status: ClipStatus; assignee: string },
  currentUsername: string,
  isAdmin: boolean,
) {
  return (
    task.status !== "Posted" &&
    (isAdmin || task.assignee === "Unclaimed" || task.assignee === currentUsername)
  );
}
