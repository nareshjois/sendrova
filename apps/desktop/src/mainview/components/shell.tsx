import { Button } from "@/components/ui/button";
import { ConnectionDot } from "@/components/status-badge";
import { FooterSlotProvider } from "@/components/footer-actions";
import { Titlebar } from "@/components/titlebar";
import { electrobun, onConnectionStatus } from "@/lib/electrobun";
import type { AppView } from "@/lib/app-nav";
import {
	readSidebarCollapsed,
	writeSidebarCollapsed,
} from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";
import {
	Home,
	Info,
	PanelLeftClose,
	PanelLeftOpen,
	Settings,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ConnectionStatus } from "shared/rpc";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
	disconnected: "Disconnected",
	qr: "Scan QR",
	connecting: "Connecting",
	connected: "Connected",
	logged_out: "Logged out",
};

const NAV = [
	{ id: "home" as const, label: "Home", icon: Home },
	{ id: "settings" as const, label: "Settings", icon: Settings },
	{ id: "about" as const, label: "About", icon: Info },
];

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
	const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
	const footerActionsRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		electrobun.rpc?.request
			.getConnectionStatus({})
			.then(setStatus)
			.catch(() => undefined);
		return onConnectionStatus(setStatus);
	}, []);

	function toggleCollapsed() {
		setCollapsed((prev) => {
			const next = !prev;
			writeSidebarCollapsed(next);
			return next;
		});
	}

	const editorActive = view.name === "editor";
	const sidebarWidth = collapsed ? "w-14" : "w-[220px]";

	return (
		<FooterSlotProvider slotRef={footerActionsRef}>
			<div className="flex h-full flex-col overflow-hidden">
				<Titlebar />

				<div className="flex min-h-0 flex-1 overflow-hidden">
					<aside
						className={cn(
							"flex h-full shrink-0 flex-col border-r bg-card/60 backdrop-blur-sm transition-[width] duration-200",
							sidebarWidth,
						)}
					>
						<nav
							className={cn(
								"mt-3 flex flex-1 flex-col gap-1",
								collapsed ? "items-center px-1.5" : "px-3",
							)}
						>
							{NAV.map((item) => {
								const active = view.name === item.id;
								const Icon = item.icon;
								return (
									<Button
										key={item.id}
										variant={active ? "secondary" : "ghost"}
										size={collapsed ? "icon" : "default"}
										title={collapsed ? item.label : undefined}
										aria-label={item.label}
										className={cn(
											"transition-all duration-200",
											collapsed
												? "size-9"
												: "w-full justify-start gap-2.5",
											active && "font-medium shadow-sm",
										)}
										onClick={() => onNavigate({ name: item.id })}
									>
										<Icon className="size-4 shrink-0" strokeWidth={1.75} />
										{!collapsed && <span>{item.label}</span>}
									</Button>
								);
							})}
						</nav>

						<div
							className={cn(
								"shrink-0 border-t py-2",
								collapsed ? "flex justify-center px-1.5" : "px-3",
							)}
						>
							<Button
								variant="ghost"
								size={collapsed ? "icon" : "sm"}
								className={cn(
									"text-muted-foreground",
									collapsed ? "size-9" : "w-full justify-start gap-2",
								)}
								aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
								title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
								onClick={toggleCollapsed}
							>
								{collapsed ? (
									<PanelLeftOpen className="size-4" strokeWidth={1.75} />
								) : (
									<>
										<PanelLeftClose className="size-4" strokeWidth={1.75} />
										<span>Collapse</span>
									</>
								)}
							</Button>
						</div>
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
					<div
						className={cn(
							"flex h-full shrink-0 items-center transition-[width] duration-200",
							sidebarWidth,
							collapsed ? "justify-center px-1.5" : "px-3",
						)}
					>
						<div
							className={cn(
								"flex min-w-0 items-center gap-2",
								collapsed ? "justify-center" : "px-1",
							)}
							title={STATUS_LABEL[status]}
						>
							<ConnectionDot status={status} />
							{!collapsed && (
								<span className="truncate text-xs text-muted-foreground">
									{STATUS_LABEL[status]}
								</span>
							)}
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
