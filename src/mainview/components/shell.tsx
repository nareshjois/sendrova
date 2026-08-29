import { Button } from "@/components/ui/button";
import { ConnectionDot } from "@/components/status-badge";
import { FooterSlotProvider } from "@/components/footer-actions";
import { Titlebar } from "@/components/titlebar";
import { electrobun, onConnectionStatus } from "@/lib/electrobun";
import type { AppView } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ConnectionStatus } from "shared/rpc";
import appIcon from "@/assets/app-icon.png";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
	disconnected: "Disconnected",
	qr: "Scan QR",
	connecting: "Connecting",
	connected: "Connected",
	logged_out: "Logged out",
};

export function Shell({
	view,
	onNavigate,
	children,
}: {
	view: AppView;
	onNavigate: (v: AppView) => void;
	children: ReactNode;
}) {
	const [status, setStatus] = useState<ConnectionStatus>("disconnected");
	const footerActionsRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		electrobun.rpc?.request
			.getConnectionStatus({})
			.then(setStatus)
			.catch(() => undefined);
		return onConnectionStatus(setStatus);
	}, []);

	const homeActive = view.name === "home";
	const settingsActive = view.name === "settings";
	const aboutActive = view.name === "about";
	const editorActive = view.name === "editor";

	return (
		<FooterSlotProvider slotRef={footerActionsRef}>
			<div className="flex h-full flex-col overflow-hidden">
				<Titlebar />

				<div className="flex min-h-0 flex-1 overflow-hidden">
					<aside className="flex h-full w-[220px] shrink-0 flex-col border-r bg-card/60 backdrop-blur-sm">
						<div className="flex items-center gap-2.5 px-5 pb-2 pt-5">
							<img
								src={appIcon}
								alt=""
								width={32}
								height={32}
								className="size-8 shrink-0 rounded-md shadow-sm"
							/>
							<div className="min-w-0">
								<p className="truncate text-xl font-semibold tracking-tight text-foreground">
									Sendrova
								</p>
								<p className="truncate text-xs text-muted-foreground">
									WhatsApp campaigns
								</p>
							</div>
						</div>

						<nav className="mt-4 flex flex-1 flex-col gap-1 px-3">
							<Button
								variant={homeActive ? "secondary" : "ghost"}
								className={cn(
									"justify-start transition-all duration-200",
									homeActive && "font-medium shadow-sm",
								)}
								onClick={() => onNavigate({ name: "home" })}
							>
								Home
							</Button>
							<Button
								variant={settingsActive ? "secondary" : "ghost"}
								className={cn(
									"justify-start transition-all duration-200",
									settingsActive && "font-medium shadow-sm",
								)}
								onClick={() => onNavigate({ name: "settings" })}
							>
								Settings
							</Button>
							<Button
								variant={aboutActive ? "secondary" : "ghost"}
								className={cn(
									"justify-start transition-all duration-200",
									aboutActive && "font-medium shadow-sm",
								)}
								onClick={() => onNavigate({ name: "about" })}
							>
								About
							</Button>
						</nav>
					</aside>

					<main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
						<div
							key={view.name}
							className={cn(
								"absolute inset-0 animate-page-in",
								editorActive ? "flex flex-col" : "overflow-y-auto p-6",
							)}
						>
							{children}
						</div>
					</main>
				</div>

				<footer className="flex h-14 shrink-0 items-center border-t bg-card/95 backdrop-blur-sm">
					<div className="flex h-full w-[220px] shrink-0 items-center px-3">
						<div className="flex min-w-0 items-center gap-2 px-1">
							<ConnectionDot status={status} />
							<span className="truncate text-xs text-muted-foreground">
								{STATUS_LABEL[status]}
							</span>
						</div>
					</div>
					<div
						ref={footerActionsRef}
						className="flex min-w-0 flex-1 items-center justify-end gap-2 px-6"
					/>
				</footer>
			</div>
		</FooterSlotProvider>
	);
}
