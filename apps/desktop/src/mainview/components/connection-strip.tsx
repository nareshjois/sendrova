import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { electrobun, onConnectionStatus, onQr } from "@/lib/electrobun";
import { cn } from "@/lib/utils";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import type { ConnectionStatus, SmsConnectionDTO } from "shared/rpc";

const WA_STATUS_LABEL: Record<ConnectionStatus, string> = {
	disconnected: "Disconnected",
	qr: "Scan QR",
	connecting: "Connecting…",
	connected: "Connected",
	logged_out: "Logged out",
};

function waStatusVariant(
	status: ConnectionStatus,
): "default" | "secondary" | "destructive" | "outline" {
	switch (status) {
		case "connected":
			return "default";
		case "qr":
		case "connecting":
			return "secondary";
		case "logged_out":
			return "destructive";
		default:
			return "outline";
	}
}

function smsBadge(
	sms: SmsConnectionDTO | null,
): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
	if (!sms) return { label: "…", variant: "outline" };
	if (sms.mode === "mock") return { label: "Mock ready", variant: "secondary" };
	if (sms.relayReachable === false) {
		return { label: "Relay down", variant: "destructive" };
	}
	if (sms.status === "paired") {
		if (sms.online === true) return { label: "Online", variant: "default" };
		if (sms.online === false) return { label: "Offline", variant: "destructive" };
		return { label: "Paired", variant: "default" };
	}
	if (sms.status === "pending") return { label: "Scan QR", variant: "secondary" };
	return { label: "Unpaired", variant: "outline" };
}

function friendlySmsError(raw: string): string {
	if (/SMS relay unreachable/i.test(raw) || /fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(raw)) {
		return "SMS relay unreachable. Check network access to the built-in Worker, or run local wrangler and set SMS_RELAY_BASE_URL.";
	}
	return raw;
}

function WhatsAppStripSection() {
	const [status, setStatus] = useState<ConnectionStatus>("disconnected");
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [qrExpanded, setQrExpanded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [logoutOpen, setLogoutOpen] = useState(false);

	useEffect(() => {
		let cancelled = false;

		electrobun.rpc?.request
			.getConnectionStatus({})
			.then((s) => {
				if (!cancelled) setStatus(s);
			})
			.catch((err: unknown) => {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			});

		const unsubStatus = onConnectionStatus((s) => {
			setStatus(s);
			if (s === "connected" || s === "disconnected" || s === "logged_out") {
				setQrDataUrl(null);
				if (s === "connected") setQrExpanded(false);
			}
		});

		const unsubQr = onQr((qr) => {
			QRCode.toDataURL(qr, { width: 220, margin: 2, errorCorrectionLevel: "M" })
				.then((url) => {
					if (!cancelled) {
						setQrDataUrl(url);
						setQrExpanded(true);
						setError(null);
					}
				})
				.catch((err: unknown) => {
					if (!cancelled) {
						setError(err instanceof Error ? err.message : String(err));
					}
				});
		});

		return () => {
			cancelled = true;
			unsubStatus();
			unsubQr();
		};
	}, []);

	async function handleConnect() {
		setBusy(true);
		setError(null);
		try {
			await electrobun.rpc?.request.startSession({});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	async function handleLogout() {
		setBusy(true);
		setError(null);
		try {
			await electrobun.rpc?.request.logout({});
			setQrDataUrl(null);
			setQrExpanded(false);
			setLogoutOpen(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	const canConnect =
		status === "disconnected" || status === "logged_out" || status === "qr";
	const canLogout =
		status === "connected" || status === "qr" || status === "connecting";
	const showQrSection = qrDataUrl || status === "qr" || status === "connecting";

	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					<span className="text-sm font-medium">WhatsApp</span>
					<Badge variant={waStatusVariant(status)}>
						{WA_STATUS_LABEL[status]}
					</Badge>
				</div>
				<div className="flex items-center gap-2">
					{showQrSection && (
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setQrExpanded((v) => !v)}
						>
							{qrExpanded ? "Hide QR" : "Show QR"}
						</Button>
					)}
					{canConnect && (
						<Button size="sm" disabled={busy} onClick={handleConnect}>
							{status === "qr" ? "Refresh QR" : "Connect"}
						</Button>
					)}
					{canLogout && (
						<Button
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={() => setLogoutOpen(true)}
						>
							Logout
						</Button>
					)}
				</div>
			</div>

			{error && (
				<Alert variant="destructive" className="mt-3">
					<AlertTitle>WhatsApp connection error</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{qrExpanded && (
				<div className="mt-3 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center">
					{status === "connecting" && !qrDataUrl && (
						<p className="text-sm text-muted-foreground">
							Connecting… restoring session if one exists.
						</p>
					)}
					{qrDataUrl && (
						<>
							<img
								src={qrDataUrl}
								alt="WhatsApp QR code"
								className="rounded-md border bg-white p-2"
								width={220}
								height={220}
							/>
							<p className="max-w-sm text-sm text-muted-foreground">
								Open WhatsApp → Linked devices → Link a device, then scan this QR
								code.
							</p>
						</>
					)}
				</div>
			)}

			<Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Log out of WhatsApp?</DialogTitle>
						<DialogDescription>
							This clears the local session. You will need to scan a QR code again
							to reconnect.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setLogoutOpen(false)}>
							Cancel
						</Button>
						<Button variant="destructive" disabled={busy} onClick={handleLogout}>
							Logout
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function SmsStripSection() {
	const [sms, setSms] = useState<SmsConnectionDTO | null>(null);
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [qrExpanded, setQrExpanded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [unpairOpen, setUnpairOpen] = useState(false);

	const applySms = useCallback(async (next: SmsConnectionDTO) => {
		setSms(next);
		if (next.qrPayload) {
			try {
				const url = await QRCode.toDataURL(next.qrPayload, {
					width: 220,
					margin: 2,
					errorCorrectionLevel: "M",
				});
				setQrDataUrl(url);
				if (next.status === "pending") setQrExpanded(true);
			} catch (err: unknown) {
				setError(err instanceof Error ? err.message : String(err));
			}
		} else if (next.status !== "pending") {
			setQrDataUrl(null);
			setQrExpanded(false);
		}
	}, []);

	const refresh = useCallback(async () => {
		const next = await electrobun.rpc!.request.refreshSmsPairStatus({});
		await applySms(next);
		return next;
	}, [applySms]);

	useEffect(() => {
		let cancelled = false;

		async function load() {
			try {
				const next = await electrobun.rpc!.request.getSmsConnection({});
				if (!cancelled) {
					setError(null);
					await applySms(next);
				}
			} catch (err: unknown) {
				if (!cancelled) {
					setError(
						friendlySmsError(err instanceof Error ? err.message : String(err)),
					);
				}
			}
		};

		void load();
		return () => {
			cancelled = true;
		};
	}, [applySms]);

	// Poll pair status while pending; poll health while paired (live).
	useEffect(() => {
		if (!sms || sms.mode === "mock") return;
		if (sms.status !== "pending" && sms.status !== "paired") return;

		let cancelled = false;
		const tick = async () => {
			try {
				const next = await refresh();
				if (cancelled) return;
				if (next.relayReachable === false) {
					setError(
						friendlySmsError(
							"SMS relay unreachable — is the Worker up?",
						),
					);
					return;
				}
				if (next.status === "paired" && next.online !== false) {
					setError(null);
				}
				if (next.status === "unpaired") {
					setError(null);
				}
			} catch (err: unknown) {
				if (!cancelled) {
					setError(
						friendlySmsError(err instanceof Error ? err.message : String(err)),
					);
				}
			}
		};

		const intervalMs = sms.status === "pending" ? 2_000 : 5_000;
		const id = setInterval(() => {
			void tick();
		}, intervalMs);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [sms?.mode, sms?.status, refresh]);

	async function handlePair() {
		setBusy(true);
		setError(null);
		try {
			const started = await electrobun.rpc!.request.startSmsPair({});
			const next = await electrobun.rpc!.request.getSmsConnection({});
			await applySms({ ...next, qrPayload: started.qrPayload });
			setQrExpanded(true);
		} catch (err) {
			setError(
				friendlySmsError(err instanceof Error ? err.message : String(err)),
			);
		} finally {
			setBusy(false);
		}
	}

	async function handleUnpair() {
		setBusy(true);
		setError(null);
		try {
			const next = await electrobun.rpc!.request.unpairSms({});
			await applySms(next);
			setUnpairOpen(false);
		} catch (err) {
			setError(
				friendlySmsError(err instanceof Error ? err.message : String(err)),
			);
		} finally {
			setBusy(false);
		}
	}

	const badge = smsBadge(sms);
	const isLive = sms?.mode === "live";
	const canPair =
		isLive && (sms?.status === "unpaired" || sms?.status === "pending");
	const canUnpair = isLive && (sms?.status === "paired" || sms?.status === "pending");
	const showQrToggle = Boolean(qrDataUrl) || sms?.status === "pending";

	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<span className="text-sm font-medium">SMS</span>
					<Badge variant={badge.variant}>{badge.label}</Badge>
					{sms?.mode === "live" && sms.relayBaseUrl && (
						<span className="truncate font-mono text-[11px] text-muted-foreground">
							{sms.relayBaseUrl}
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					{showQrToggle && (
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setQrExpanded((v) => !v)}
						>
							{qrExpanded ? "Hide QR" : "Show QR"}
						</Button>
					)}
					{canPair && (
						<Button size="sm" disabled={busy} onClick={() => void handlePair()}>
							{sms?.status === "pending" ? "Refresh QR" : "Pair phone"}
						</Button>
					)}
					{canUnpair && (
						<Button
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={() => setUnpairOpen(true)}
						>
							Unpair
						</Button>
					)}
				</div>
			</div>

			{sms?.mode === "mock" && (
				<p className="mt-2 text-sm text-muted-foreground">
					Mock SMS relay is active (
					<span className="font-mono text-xs">SMS_RELAY_MOCK</span>). Campaigns
					can run without a phone; unset mock mode to pair a real gateway.
				</p>
			)}

			{error && (
				<Alert variant="destructive" className="mt-3">
					<AlertTitle>
						{error.includes("relay unreachable")
							? "SMS relay unreachable"
							: "SMS connection error"}
					</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{sms?.relayReachable === false && !error && (
				<Alert variant="destructive" className="mt-3">
					<AlertTitle>SMS relay unreachable</AlertTitle>
					<AlertDescription>
						Cannot reach the SMS relay Worker. Check network access to the
						built-in relay, or run local wrangler with{" "}
						<span className="font-mono text-xs">SMS_RELAY_BASE_URL</span>.
					</AlertDescription>
				</Alert>
			)}

			{qrExpanded && qrDataUrl && (
				<div className="mt-3 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center">
					<img
						src={qrDataUrl}
						alt="SMS pair QR code"
						className="rounded-md border bg-white p-2"
						width={220}
						height={220}
					/>
					<p className="max-w-sm text-sm text-muted-foreground">
						Open the Sendrova SMS app on your Android phone and scan this QR to
						pair. Status becomes Online after the phone reaches the relay.
						Campaigns mark messages sent only after the phone acknowledges each
						job — not when they are queued.
					</p>
				</div>
			)}

			<Dialog open={unpairOpen} onOpenChange={setUnpairOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Unpair SMS phone?</DialogTitle>
						<DialogDescription>
							This clears the desktop pairing. The phone will stop receiving new
							SMS jobs until you pair again.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setUnpairOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={busy}
							onClick={() => void handleUnpair()}
						>
							Unpair
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

export function ConnectionStrip({ className }: { className?: string }) {
	return (
		<div
			className={cn(
				"space-y-0 overflow-hidden rounded-xl border bg-card/80 shadow-sm backdrop-blur-sm",
				className,
			)}
		>
			<div className="px-4 py-3">
				<WhatsAppStripSection />
			</div>
			<div className="border-t px-4 py-3">
				<SmsStripSection />
			</div>
		</div>
	);
}
