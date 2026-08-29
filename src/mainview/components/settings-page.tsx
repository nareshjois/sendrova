import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AppView } from "@/lib/app-nav";
import { electrobun, onDashboardChanged } from "@/lib/electrobun";
import { useCallback, useEffect, useState } from "react";
import type { DashboardDTO, SettingsDTO } from "shared/rpc";

function msToSec(ms: number): number {
	return Math.round(ms / 1000);
}

function secToMs(sec: number): number {
	return Math.max(0, Math.round(sec * 1000));
}

export function SettingsPage({
	onNavigate,
}: {
	onNavigate: (v: AppView) => void;
}) {
	const [delayMinS, setDelayMinS] = useState(4);
	const [delayMaxS, setDelayMaxS] = useState(12);
	const [extraPauseChance, setExtraPauseChance] = useState(0.1);
	const [extraPauseMinS, setExtraPauseMinS] = useState(20);
	const [extraPauseMaxS, setExtraPauseMaxS] = useState(45);
	const [maxMessagesPerDay, setMaxMessagesPerDay] = useState(80);
	const [dashboard, setDashboard] = useState<DashboardDTO | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [savedAt, setSavedAt] = useState<string | null>(null);

	const applySettings = useCallback((s: SettingsDTO) => {
		setDelayMinS(msToSec(s.delayMinMs));
		setDelayMaxS(msToSec(s.delayMaxMs));
		setExtraPauseChance(s.extraPauseChance);
		setExtraPauseMinS(msToSec(s.extraPauseMinMs));
		setExtraPauseMaxS(msToSec(s.extraPauseMaxMs));
		setMaxMessagesPerDay(s.maxMessagesPerDay);
	}, []);

	const loadDashboard = useCallback(async () => {
		try {
			const d = await electrobun.rpc!.request.getDashboard({});
			setDashboard(d);
		} catch {
			// optional ribbon
		}
	}, []);

	useEffect(() => {
		let cancelled = false;
		electrobun.rpc?.request
			.getSettings({})
			.then((s) => {
				if (!cancelled) applySettings(s);
			})
			.catch((err: unknown) => {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			});
		void loadDashboard();
		return onDashboardChanged(() => {
			void loadDashboard();
		});
	}, [applySettings, loadDashboard]);

	async function writeThrough(patch: Partial<SettingsDTO>) {
		setBusy(true);
		setError(null);
		try {
			const next = await electrobun.rpc!.request.setSettings(patch);
			applySettings(next);
			setSavedAt(new Date().toLocaleTimeString());
			await loadDashboard();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="mx-auto max-w-xl space-y-5">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
					<p className="text-sm text-muted-foreground">
						Pacing and daily send limits
					</p>
				</div>
				<Button variant="outline" onClick={() => onNavigate({ name: "home" })}>
					Back to Home
				</Button>
			</div>

			{error && (
				<Alert variant="destructive">
					<AlertTitle>Error</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{dashboard && (
				<div className="grid grid-cols-2 gap-2">
					<div className="rounded-lg border bg-card/70 px-3 py-2.5">
						<p className="text-xs text-muted-foreground">Sent today</p>
						<p className="font-mono text-lg font-medium">{dashboard.sentToday}</p>
					</div>
					<div className="rounded-lg border bg-card/70 px-3 py-2.5">
						<p className="text-xs text-muted-foreground">Remaining today</p>
						<p className="font-mono text-lg font-medium">
							{dashboard.remainingToday}
						</p>
					</div>
				</div>
			)}

			<Card>
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between gap-2">
						<CardTitle className="text-base">Send pacing</CardTitle>
						{savedAt && (
							<span className="text-xs text-muted-foreground">
								Saved {savedAt}
							</span>
						)}
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<Label htmlFor="delay-min">Delay min (s)</Label>
							<Input
								id="delay-min"
								type="number"
								min={0}
								step={1}
								value={delayMinS}
								disabled={busy}
								onChange={(e) => setDelayMinS(Number(e.target.value))}
								onBlur={() =>
									writeThrough({
										delayMinMs: secToMs(delayMinS),
										delayMaxMs: secToMs(Math.max(delayMinS, delayMaxS)),
									})
								}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="delay-max">Delay max (s)</Label>
							<Input
								id="delay-max"
								type="number"
								min={0}
								step={1}
								value={delayMaxS}
								disabled={busy}
								onChange={(e) => setDelayMaxS(Number(e.target.value))}
								onBlur={() =>
									writeThrough({
										delayMinMs: secToMs(Math.min(delayMinS, delayMaxS)),
										delayMaxMs: secToMs(delayMaxS),
									})
								}
							/>
						</div>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="extra-chance">Extra pause chance (0–1)</Label>
						<Input
							id="extra-chance"
							type="number"
							min={0}
							max={1}
							step={0.05}
							value={extraPauseChance}
							disabled={busy}
							onChange={(e) => setExtraPauseChance(Number(e.target.value))}
							onBlur={() =>
								writeThrough({
									extraPauseChance: Math.min(
										1,
										Math.max(0, extraPauseChance),
									),
								})
							}
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<Label htmlFor="extra-min">Extra pause min (s)</Label>
							<Input
								id="extra-min"
								type="number"
								min={0}
								step={1}
								value={extraPauseMinS}
								disabled={busy}
								onChange={(e) => setExtraPauseMinS(Number(e.target.value))}
								onBlur={() =>
									writeThrough({
										extraPauseMinMs: secToMs(extraPauseMinS),
										extraPauseMaxMs: secToMs(
											Math.max(extraPauseMinS, extraPauseMaxS),
										),
									})
								}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="extra-max">Extra pause max (s)</Label>
							<Input
								id="extra-max"
								type="number"
								min={0}
								step={1}
								value={extraPauseMaxS}
								disabled={busy}
								onChange={(e) => setExtraPauseMaxS(Number(e.target.value))}
								onBlur={() =>
									writeThrough({
										extraPauseMinMs: secToMs(
											Math.min(extraPauseMinS, extraPauseMaxS),
										),
										extraPauseMaxMs: secToMs(extraPauseMaxS),
									})
								}
							/>
						</div>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="max-day">Max messages per day</Label>
						<Input
							id="max-day"
							type="number"
							min={1}
							step={1}
							value={maxMessagesPerDay}
							disabled={busy}
							onChange={(e) => setMaxMessagesPerDay(Number(e.target.value))}
							onBlur={() =>
								writeThrough({
									maxMessagesPerDay: Math.max(1, Math.round(maxMessagesPerDay)),
								})
							}
						/>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Updates</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2">
					<p className="text-sm text-muted-foreground">
						Check for app updates from GitHub Releases (configured in
						shared/release-config.ts).
					</p>
					<Button
						variant="outline"
						size="sm"
						onClick={() => onNavigate({ name: "about" })}
					>
						Open About &amp; updates
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
