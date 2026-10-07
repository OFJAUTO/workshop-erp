import { Badge } from "./ui";
import { type Priority, type Timing } from "@/lib/jobs";

export function TimingBadge({ timing }: { timing: Timing }) {
  if (timing.tone === "neutral") return null;
  return <Badge tone={timing.tone}>{timing.label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === "normal") return null;
  return <Badge tone="outline">{priority === "high" ? "High priority" : "Low priority"}</Badge>;
}
