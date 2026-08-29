import { CampaignStatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { AppView } from "@/lib/app-nav";
import { statusLabel } from "@/lib/app-nav";
import { electrobun, onProgress } from "@/lib/electrobun";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	AttemptDTO,
	AttemptStatusDTO,
	CampaignDTO,
	CampaignProgressDTO,
} from "shared/rpc";

function attemptVariant(
	status: string,
): "default" | "secondary" | "destructive" | "outline" {
	switch (status) {
		case "sent":
			return "default";
		case "failed":
			return "destructive";
		case "skipped":
		case "sending":
			return "secondary";
		default:
			return "outline";
	}
}

function formatCountdown(ms: number | undefined, seconds: number | undefined): string {
	if (seconds != null) return `${Math.max(0, Math.ceil(seconds))}s`;
	if (ms == null) return "—";
	return `${Math.max(0, Math.ceil(ms / 1000))}s`;
}

export function ProgressPage({
	campaignId,
	onNavigate,
}: {
	campaignId: string;
	onNavigate: (v: AppView) => void;
}) {
	const [activeId, setActiveId] = useState(campaignId);
	const [campaign, setCampaign] = useState<CampaignDTO | null>(null);
	const [attempts, setAttempts] = useState<AttemptDTO[]>([]);
	const [progress, setProgress] = useState<CampaignProgressDTO | null>(null);
	const [runningIds, setRunningIds] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const loadCampaign = useCallback(async (id: string) => {
		try {
			const detail = await electrobun.rpc!.request.getCampaign({ id });
			if (!detail) {
				setError("Campaign not found");
				setCampaign(null);
				setAttempts([]);
				return;
			}
			setCampaign(detail.campaign);
			setAttempts(detail.attempts);
			setError(null);
			const live = await electrobun.rpc!.request.getProgress({ id });
			if (live) setProgress(live);
			else {
				setProgress({
					campaignId: detail.campaign.id,
					status: detail.campaign.status,
					pausedReason: detail.campaign.paused_reason,
					rowIndex: 0,
					total: detail.campaign.row_count,
					sent: detail.campaign.sent_count,
					failed: detail.campaign.failed_count,
					skipped: detail.campaign.skipped_count,
					pending: detail.campaign.pending_count,
				});
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	useEffect(() => {
		setActiveId(campaignId);
	}, [campaignId]);

	useEffect(() => {
		void loadCampaign(activeId);
		electrobun.rpc?.request
			.listRunning({})
			.then(setRunningIds)
			.catch(() => undefined);
	}, [activeId, loadCampaign]);

	useEffect(() => {
		return onProgress((p) => {
			if (p.campaignId !== activeId) return;
			setProgress(p);
			setCampaign((prev) =>
				prev
					? {
							...prev,
							status: p.status as CampaignDTO["status"],
							paused_reason: p.pausedReason ?? prev.paused_reason,
							sent_count: p.sent,
							failed_count: p.failed,
							skipped_count: p.skipped,
							pending_count: p.pending,
						}
					: prev,
			);
		});
	}, [activeId]);

	const status = progress?.status ?? campaign?.status ?? "draft";
	const pausedReason =
		progress?.pausedReason ?? campaign?.paused_reason ?? null;
	const total = progress?.total ?? campaign?.row_count ?? 0;
	const sent = progress?.sent ?? campaign?.sent_count ?? 0;
	const failed = progress?.failed ?? campaign?.failed_count ?? 0;
	const skipped = progress?.skipped ?? campaign?.skipped_count ?? 0;
	const pending = progress?.pending ?? campaign?.pending_count ?? 0;
	const done = sent + failed + skipped;
	const pct = total > 0 ? Math.round((done / total) * 100) : 0;

	const rows = useMemo(() => {
		const rowStatuses = progress?.rowStatuses;
		if (rowStatuses && Object.keys(rowStatuses).length > 0) {
			const indices = Object.keys(rowStatuses)
				.map(Number)
				.sort((a, b) => a - b);
			return indices.map((idx) => {
				const attempt = attempts.find((a) => a.row_index === idx);
				return {
					rowIndex: idx,
					phone: attempt?.phone ?? progress?.currentPhone ?? "—",
					status: rowStatuses[String(idx)] as AttemptStatusDTO,
					error: attempt?.error ?? null,
				};
			});
		}
		return attempts.map((a) => ({
			rowIndex: a.row_index,
			phone: a.phone,
			status: a.status,
			error: a.error,
		}));
	}, [attempts, progress]);

	async function run(action: () => Promise<unknown>) {
		setBusy(true);
		setError(null);
		try {
			await action();
			await loadCampaign(activeId);
			const running = await electrobun.rpc!.request.listRunning({});
			setRunningIds(running);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="mx-auto max-w-3xl space-y-5">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{campaign?.name ?? "Progress"}
					</h1>
					<p className="text-sm text-muted-foreground">Live send progress</p>
				</div>
				<Button
					variant="outline"
					onClick={() => onNavigate({ name: "home" })}
				>
					Back to Home
				</Button>
			</div>

			{runningIds.length > 1 && (
				<div className="flex flex-wrap gap-1.5">
					{runningIds.map((id) => (
						<Button
							key={id}
							size="sm"
							variant={id === activeId ? "default" : "outline"}
							onClick={() => {
								setActiveId(id);
								onNavigate({ name: "progress", campaignId: id });
							}}
						>
							{id === activeId ? "This campaign" : id.slice(0, 8)}
						</Button>
					))}
				</div>
			)}

			{error && (
				<Alert variant="destructive">
					<AlertTitle>Error</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{pausedReason === "daily_limit" && (
				<Alert>
					<AlertTitle>Paused — daily limit</AlertTitle>
					<AlertDescription>
						This campaign hit the daily message cap. Resume after midnight or raise
						the limit in Settings.
					</AlertDescription>
				</Alert>
			)}

			<Card>
				<CardHeader className="pb-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<CardTitle className="text-base capitalize">
							{statusLabel(status)}
						</CardTitle>
						<CampaignStatusBadge status={status} pausedReason={pausedReason} />
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex flex-wrap items-end justify-between gap-3">
						<div>
							<p className="text-xs text-muted-foreground">Next delay</p>
							<p className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
								{formatCountdown(
									progress?.countdownRemainingMs ?? progress?.nextDelayMs,
									progress?.countdownSeconds,
								)}
							</p>
						</div>
						<p className="font-mono text-sm text-muted-foreground">
							{done}/{total} · {pct}%
						</p>
					</div>
					<Progress value={pct} />
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
						<div className="rounded-md border px-3 py-2">
							<p className="text-xs text-muted-foreground">Sent</p>
							<p className="font-mono text-lg">{sent}</p>
						</div>
						<div className="rounded-md border px-3 py-2">
							<p className="text-xs text-muted-foreground">Failed</p>
							<p className="font-mono text-lg">{failed}</p>
						</div>
						<div className="rounded-md border px-3 py-2">
							<p className="text-xs text-muted-foreground">Skipped</p>
							<p className="font-mono text-lg">{skipped}</p>
						</div>
						<div className="rounded-md border px-3 py-2">
							<p className="text-xs text-muted-foreground">Pending</p>
							<p className="font-mono text-lg">{pending}</p>
						</div>
					</div>
					{progress?.currentPhone && (
						<p className="font-mono text-xs text-muted-foreground">
							Current: {progress.currentPhone}
						</p>
					)}
					{progress?.lastError && (
						<p className="text-sm text-destructive">{progress.lastError}</p>
					)}
					<div className="flex flex-wrap gap-2">
						{status === "running" && (
							<Button
								size="sm"
								variant="secondary"
								disabled={busy}
								onClick={() =>
									run(() =>
										electrobun.rpc!.request.pauseCampaign({ id: activeId }),
									)
								}
							>
								Pause
							</Button>
						)}
						{status === "paused" && (
							<Button
								size="sm"
								disabled={busy}
								onClick={() =>
									run(() =>
										electrobun.rpc!.request.resumeCampaign({ id: activeId }),
									)
								}
							>
								Resume
							</Button>
						)}
						{(status === "running" || status === "paused") && (
							<Button
								size="sm"
								variant="destructive"
								disabled={busy}
								onClick={() =>
									run(() =>
										electrobun.rpc!.request.stopCampaign({ id: activeId }),
									)
								}
							>
								Stop
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Contacts</CardTitle>
				</CardHeader>
				<CardContent>
					{rows.length === 0 ? (
						<p className="text-sm text-muted-foreground">No attempts yet.</p>
					) : (
						<ScrollArea className="h-72">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>#</TableHead>
										<TableHead>Phone</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Error</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{rows.map((row) => (
										<TableRow key={row.rowIndex}>
											<TableCell className="font-mono text-xs">
												{row.rowIndex + 1}
											</TableCell>
											<TableCell className="font-mono text-xs">
												{row.phone}
											</TableCell>
											<TableCell>
												<Badge
													variant={attemptVariant(row.status)}
													className="capitalize"
												>
													{row.status}
												</Badge>
											</TableCell>
											<TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
												{row.error ?? "—"}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</ScrollArea>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
