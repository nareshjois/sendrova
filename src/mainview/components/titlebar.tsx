import { electrobun } from "@/lib/electrobun";
import { cn } from "@/lib/utils";
import { Minus, Square, X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

const showCustomControls =
	typeof navigator !== "undefined" &&
	!/Macintosh|Mac OS X/i.test(navigator.userAgent);

export function Titlebar() {
	const [maximized, setMaximized] = useState(false);

	useEffect(() => {
		if (!showCustomControls) return;
		electrobun.rpc?.request
			.isWindowMaximized({})
			.then((r) => setMaximized(r.maximized))
			.catch(() => undefined);
	}, []);

	return (
		<header
			className={cn(
				"titlebar electrobun-webkit-app-region-drag flex h-9 shrink-0 items-center border-b bg-card/80 backdrop-blur-sm",
				showCustomControls ? "justify-end pr-1.5" : "px-3",
			)}
			style={{ WebkitAppRegion: "drag", appRegion: "drag" } as CSSProperties}
		>
			{!showCustomControls && (
				<span className="text-xs text-muted-foreground">Sendrova</span>
			)}
			{showCustomControls && (
				<nav
					className="window-controls electrobun-webkit-app-region-no-drag flex items-center gap-0.5"
					style={
						{ WebkitAppRegion: "no-drag", appRegion: "no-drag" } as CSSProperties
					}
				>
					<button
						type="button"
						aria-label="Minimize"
						className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
						onClick={() => void electrobun.rpc?.request.minimizeWindow({})}
					>
						<Minus className="size-3.5" strokeWidth={2} />
					</button>
					<button
						type="button"
						aria-label={maximized ? "Restore" : "Maximize"}
						className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
						onClick={() => {
							void electrobun.rpc?.request.maximizeWindow({}).then((r) => {
								setMaximized(r.maximized);
							});
						}}
					>
						<Square className="size-3" strokeWidth={2} />
					</button>
					<button
						type="button"
						aria-label="Close"
						className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive active:scale-95"
						onClick={() => void electrobun.rpc?.request.closeWindow({})}
					>
						<X className="size-3.5" strokeWidth={2} />
					</button>
				</nav>
			)}
		</header>
	);
}
