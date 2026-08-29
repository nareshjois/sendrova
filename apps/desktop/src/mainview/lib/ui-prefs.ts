const SIDEBAR_COLLAPSED_KEY = "sendrova.sidebarCollapsed";

export function readSidebarCollapsed(): boolean {
	try {
		return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
	} catch {
		return false;
	}
}

export function writeSidebarCollapsed(collapsed: boolean): void {
	try {
		localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
	} catch {
		/* ignore quota / private mode */
	}
}
