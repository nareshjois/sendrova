import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHANGELOG_ENTRIES } from "@/lib/changelog";
import { electrobun } from "@/lib/electrobun";
import type { AppView } from "@/lib/app-nav";
import { useCallback, useEffect, useState } from "react";
import type { AppInfoDTO, UpdateCheckDTO } from "shared/rpc";

const DEVELOPER_URL = "https://www.nareshjois.com/";
const DEVELOPER_LOGO = "https://www.nareshjois.com/logo.svg";

export function AboutPage({
	onNavigate,
}: {
	onNavigate: (v: AppView) => void;
}) {
	const [info, setInfo] = useState<AppInfoDTO | null>(null);
	const [update, setUpdate] = useState<UpdateCheckDTO | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const loadInfo = useCallback(async () => {
		try {
			const app = await electrobun.rpc!.request.getAppInfo({});
			setInfo(app);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	useEffect(() => {
		void loadInfo();
	}, [loadInfo]);

	async function handleCheck() {
		setBusy(true);
		setError(null);
		try {
			const result = await electrobun.rpc!.request.checkForUpdate({});
			setUpdate(result);
			if (result.error && !result.updatesConfigured) {
				setError(result.error);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	async function handleApply() {
		setBusy(true);
		setError(null);
		try {
			const result = await electrobun.rpc!.request.downloadAndApplyUpdate({});
			setUpdate(result);
			if (result.error) setError(result.error);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="mx-auto max-w-2xl space-y-6 animate-fade-up">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">About</h1>
				<p className="text-sm text-muted-foreground">
					Sendrova — paced campaigns on your desktop
				</p>
			</div>

			{error && (
				<Alert variant="destructive">
					<AlertTitle>Notice</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			<Card className="animate-fade-up" style={{ animationDelay: "40ms" }}>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Application</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2 text-sm">
					<p>
						<span className="text-muted-foreground">Name</span>
						<span className="ml-3 font-medium">{info?.name ?? "Sendrova"}</span>
					</p>
					<p>
						<span className="text-muted-foreground">Version</span>
						<span className="ml-3 font-mono text-xs">
							{info?.version ?? "…"}
							{info?.channel ? ` · ${info.channel}` : ""}
						</span>
					</p>
					<p className="text-muted-foreground leading-relaxed">
						Local Electrobun app for consented, paced messaging campaigns via
						Baileys (WhatsApp Web session). Campaigns, templates, media, and
						daily caps stay on this device.
					</p>
				</CardContent>
			</Card>

			<Card className="animate-fade-up" style={{ animationDelay: "80ms" }}>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Updates</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					<p className="text-sm text-muted-foreground">
						{!info
							? "Loading update configuration…"
							: info.updatesConfigured
								? info.channel === "dev"
									? `Dev channel — auto-update is disabled. Stable builds check ${info.baseUrl || "GitHub Releases"}.`
									: `Release host: ${info.baseUrl || "configured"}`
								: "Auto-update is not configured. Set GITHUB_REPO in packages/shared/release-config.ts, rebuild stable, and publish Electrobun artifacts to GitHub Releases."}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button size="sm" disabled={busy} onClick={() => void handleCheck()}>
							Check for updates
						</Button>
						{update?.updateAvailable && (
							<Button
								size="sm"
								variant="secondary"
								disabled={busy}
								onClick={() => void handleApply()}
							>
								Download &amp; apply
							</Button>
						)}
					</div>
					{update && (
						<p className="text-xs text-muted-foreground">
							{update.updateAvailable
								? `Update available → ${update.version}`
								: update.error
									? update.error
									: "You're up to date."}
						</p>
					)}
				</CardContent>
			</Card>

			<Card className="animate-fade-up" style={{ animationDelay: "120ms" }}>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Changelog</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{CHANGELOG_ENTRIES.map((entry) => (
						<div key={entry.version}>
							<p className="text-sm font-medium">
								{entry.version}{" "}
								<span className="font-normal text-muted-foreground">
									· {entry.date}
								</span>
							</p>
							<ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
								{entry.items.map((item) => (
									<li key={item}>{item}</li>
								))}
							</ul>
						</div>
					))}
				</CardContent>
			</Card>

			<Card className="animate-fade-up" style={{ animationDelay: "160ms" }}>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Developed by</CardTitle>
				</CardHeader>
				<CardContent>
					<a
						href={DEVELOPER_URL}
						target="_blank"
						rel="noreferrer"
						className="group inline-flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 transition-colors hover:bg-muted"
					>
						<img
							src={DEVELOPER_LOGO}
							alt=""
							className="size-8 object-contain"
							onError={(e) => {
								(e.currentTarget as HTMLImageElement).style.display = "none";
							}}
						/>
						<div>
							<p className="text-sm font-medium group-hover:text-accent-foreground">
								Naresh Jois
							</p>
							<p className="text-xs text-muted-foreground">nareshjois.com</p>
						</div>
					</a>
					<div className="mt-4">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onNavigate({ name: "home" })}
						>
							Back to Home
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
