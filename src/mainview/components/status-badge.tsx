import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CampaignStatus, ConnectionStatus } from "shared/rpc";

export function CampaignStatusBadge({
	status,
	pausedReason,
}: {
	status: CampaignStatus | string;
	pausedReason?: string | null;
}) {
	const label =
		status === "paused" && pausedReason === "daily_limit"
			? "paused · daily limit"
			: status.replace(/_/g, " ");

	const variant =
		status === "running"
			? "default"
			: status === "failed" || status === "stopped"
				? "destructive"
				: status === "paused" || status === "interrupted"
					? "secondary"
					: "outline";

	return (
		<Badge variant={variant} className="capitalize">
			{label}
		</Badge>
	);
}

export function ConnectionDot({ status }: { status: ConnectionStatus }) {
	return (
		<span
			className={cn(
				"inline-block size-2 rounded-full transition-colors duration-300",
				status === "connected" && "bg-[var(--success)] animate-status-pulse",
				(status === "qr" || status === "connecting") &&
					"bg-[var(--warning)] animate-status-pulse",
				status !== "connected" &&
					status !== "qr" &&
					status !== "connecting" &&
					"bg-muted-foreground/40",
			)}
		/>
	);
}
