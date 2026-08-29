import { ConnectionStrip } from "@/components/connection-strip";
import { CampaignStatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { AppView } from "@/lib/app-nav";
import { formatPct, formatWhen } from "@/lib/app-nav";
import { electrobun, onDashboardChanged } from "@/lib/electrobun";
import { useCallback, useEffect, useState } from "react";
import type { CampaignDTO, DashboardDTO } from "shared/rpc";

function Metric({
	label,
	value,
}: {
	label: string;
	value: string | number;
}) {
	return (
		<div className="rounded-lg border bg-card/70 px-3 py-2.5">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="mt-0.5 font-mono text-lg font-medium tabular-nums tracking-tight">
				{value}
			</p>
		</div>
	);
}

export function HomePage({
	onNavigate,
}: {
	onNavigate: (v: AppView) => void;
}) {
	const [dashboard, setDashboard] = useState<DashboardDTO | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const d = await electrobun.rpc!.request.getDashboard({});
			setDashboard(d);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	useEffect(() => {
		void load();
		return onDashboardChanged(() => {
			void load();
		});
	}, [load]);

	async function runAction(
		id: string,
		action: () => Promise<unknown>,
	): Promise<boolean> {
		setBusyId(id);
		setError(null);
		try {
			await action();
			await load();
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return false;
		} finally {
			setBusyId(null);
		}
	}

	async function duplicateAndEdit(id: string) {
		setBusyId(id);
		setError(null);
		try {
			const copy = await electrobun.rpc!.request.duplicateCampaign({ id });
			await load();
			onNavigate({ name: "editor", campaignId: copy.id });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusyId(null);
		}
	}

	function campaignActions(c: CampaignDTO) {
		const busy = busyId === c.id;
		const goProgress = () =>
			onNavigate({ name: "progress", campaignId: c.id });
		const goEdit = () =>
			onNavigate({ name: "editor", campaignId: c.id });

		if (c.status === "draft") {
			return (
				<>
					<Button size="sm" variant="outline" onClick={goEdit}>
						Edit
					</Button>
					<Button
						size="sm"
						disabled={busy}
						onClick={() => {
							void runAction(c.id, () =>
								electrobun.rpc!.request.startCampaign({ id: c.id }),
							).then((ok) => {
								if (ok) goProgress();
							});
						}}
					>
						Start
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={busy}
						onClick={() => void duplicateAndEdit(c.id)}
					>
						Duplicate
					</Button>
					<Button
						size="sm"
						variant="destructive"
						disabled={busy}
						onClick={() =>
							void runAction(c.id, () =>
								electrobun.rpc!.request.deleteCampaign({ id: c.id }),
							)
						}
					>
						Delete
					</Button>
				</>
			);
		}

		if (c.status === "running") {
			return (
				<>
					<Button size="sm" variant="outline" onClick={goProgress}>
						Progress
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={busy}
						onClick={() =>
							void runAction(c.id, () =>
								electrobun.rpc!.request.pauseCampaign({ id: c.id }),
							)
						}
					>
						Pause
					</Button>
					<Button
						size="sm"
						variant="destructive"
						disabled={busy}
						onClick={() =>
							void runAction(c.id, () =>
								electrobun.rpc!.request.stopCampaign({ id: c.id }),
							)
						}
					>
						Stop
					</Button>
				</>
			);
		}

		if (c.status === "paused") {
			return (
				<>
					<Button size="sm" variant="outline" onClick={goProgress}>
						Progress
					</Button>
					<Button
						size="sm"
						disabled={busy}
						onClick={() => {
							void runAction(c.id, () =>
								electrobun.rpc!.request.resumeCampaign({ id: c.id }),
							).then((ok) => {
								if (ok) goProgress();
							});
						}}
					>
						Resume
					</Button>
					<Button
						size="sm"
						variant="destructive"
						disabled={busy}
						onClick={() =>
							void runAction(c.id, () =>
								electrobun.rpc!.request.stopCampaign({ id: c.id }),
							)
						}
					>
						Stop
					</Button>
				</>
			);
		}

		const hasAttempts =
			c.sent_count + c.failed_count + c.skipped_count + c.pending_count > 0;

		return (
			<>
				<Button size="sm" variant="outline" onClick={goEdit}>
					Edit
				</Button>
				{hasAttempts && (
					<Button size="sm" variant="secondary" onClick={goProgress}>
						Progress
					</Button>
				)}
				<Button
					size="sm"
					variant="secondary"
					disabled={busy}
					onClick={() => void duplicateAndEdit(c.id)}
				>
					Duplicate
				</Button>
				<Button
					size="sm"
					variant="destructive"
					disabled={busy}
					onClick={() =>
						void runAction(c.id, () =>
							electrobun.rpc!.request.deleteCampaign({ id: c.id }),
						)
					}
				>
					Delete
				</Button>
			</>
		);
	}

	return (
		<div className="mx-auto max-w-5xl space-y-5">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Home</h1>
					<p className="text-sm text-muted-foreground">
						Campaigns, daily cap, and recent failures
					</p>
				</div>
				<Button onClick={() => onNavigate({ name: "editor", campaignId: null })}>
					New campaign
				</Button>
			</div>

			<ConnectionStrip />

			{error && (
				<Alert variant="destructive">
					<AlertTitle>Error</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{dashboard?.capHit && (
				<Alert variant="destructive">
					<AlertTitle>Daily cap reached</AlertTitle>
					<AlertDescription>
						Sent {dashboard.sentToday} of {dashboard.maxPerDay} today. Sending
						resumes after midnight ({formatWhen(dashboard.nextMidnightIso)}).
					</AlertDescription>
				</Alert>
			)}

			{dashboard && (
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
					<Metric label="Sent today" value={dashboard.sentToday} />
					<Metric label="Remaining today" value={dashboard.remainingToday} />
					<Metric label="Running" value={dashboard.runningCount} />
					<Metric label="Queue depth" value={dashboard.queueDepth} />
					<Metric
						label="Success rate"
						value={formatPct(dashboard.successRateToday)}
					/>
					<Metric
						label="Cap status"
						value={dashboard.capHit ? "hit" : "ok"}
					/>
				</div>
			)}

			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Campaigns</CardTitle>
				</CardHeader>
				<CardContent>
					{!dashboard ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : dashboard.campaigns.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No campaigns yet. Create one to get started.
						</p>
					) : (
						<div className="space-y-3">
							{dashboard.campaigns.map((c) => (
								<div
									key={c.id}
									className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3"
								>
									<div className="min-w-0 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-medium">{c.name}</span>
											<Badge variant="outline" className="capitalize">
												{c.channel === "sms" ? "SMS" : "WhatsApp"}
											</Badge>
											<CampaignStatusBadge
												status={c.status}
												pausedReason={c.paused_reason}
											/>
										</div>
										<p className="font-mono text-xs text-muted-foreground">
											{c.sent_count} sent · {c.failed_count} failed ·{" "}
											{c.pending_count} pending · {c.row_count} rows
										</p>
									</div>
									<div className="flex flex-wrap gap-1.5">
										{campaignActions(c)}
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{dashboard && dashboard.recentFailures.length > 0 && (
				<Card>
					<CardHeader className="pb-3">
						<CardTitle className="text-base">Recent failures</CardTitle>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Campaign</TableHead>
									<TableHead>Phone</TableHead>
									<TableHead>Error</TableHead>
									<TableHead>When</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{dashboard.recentFailures.map((f, i) => (
									<TableRow
										key={`${f.campaignId}-${f.phone}-${i}`}
										className="cursor-pointer"
										onClick={() =>
											onNavigate({
												name: "progress",
												campaignId: f.campaignId,
											})
										}
									>
										<TableCell className="font-medium">
											{f.campaignName}
										</TableCell>
										<TableCell className="font-mono text-xs">
											{f.phone}
										</TableCell>
										<TableCell className="max-w-[240px] truncate text-muted-foreground">
											{f.error ?? "—"}
										</TableCell>
										<TableCell className="text-xs text-muted-foreground">
											{formatWhen(f.finishedAt)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
