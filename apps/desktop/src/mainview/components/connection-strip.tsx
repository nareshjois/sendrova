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
import { useEffect, useState } from "react";
import type { ConnectionStatus } from "shared/rpc";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
	disconnected: "Disconnected",
	qr: "Scan QR",
	connecting: "Connecting…",
	connected: "Connected",
	logged_out: "Logged out",
};

function statusVariant(
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

export function ConnectionStrip({ className }: { className?: string }) {
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
			<div
				className={cn(
					"rounded-xl border bg-card/80 px-4 py-3 shadow-sm backdrop-blur-sm",
					className,
				)}
			>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2">
						<span className="text-sm font-medium">WhatsApp</span>
						<Badge variant={statusVariant(status)}>{STATUS_LABEL[status]}</Badge>
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
						<AlertTitle>Connection error</AlertTitle>
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
			</div>

			<Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Log out of WhatsApp?</DialogTitle>
						<DialogDescription>
							This clears the local session. You will need to scan a QR code again to
							reconnect.
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
