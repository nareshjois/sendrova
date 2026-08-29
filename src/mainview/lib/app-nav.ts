import type { CampaignStatus } from "shared/rpc";

export type AppView =
	| { name: "home" }
	| { name: "editor"; campaignId: string | null }
	| { name: "progress"; campaignId: string }
	| { name: "settings" }
	| { name: "about" };

export function statusLabel(status: CampaignStatus | string): string {
	return status.replace(/_/g, " ");
}

export function formatWhen(iso: string | null | undefined): string {
	if (!iso) return "—";
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}

export function formatPct(n: number | null | undefined): string {
	if (n == null || Number.isNaN(n)) return "—";
	return `${Math.round(n * 100)}%`;
}
