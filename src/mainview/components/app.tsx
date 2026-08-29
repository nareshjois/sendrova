import { CampaignEditorPage } from "@/components/campaign-editor-page";
import { AboutPage } from "@/components/about-page";
import { HomePage } from "@/components/home-page";
import { ProgressPage } from "@/components/progress-page";
import { SettingsPage } from "@/components/settings-page";
import { Shell } from "@/components/shell";
import type { AppView } from "@/lib/app-nav";
import { useEffect, useState } from "react";

export function App() {
	const [view, setView] = useState<AppView>({ name: "home" });

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key !== "Escape") return;
			if (
				view.name === "editor" ||
				view.name === "progress" ||
				view.name === "settings" ||
				view.name === "about"
			) {
				setView({ name: "home" });
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [view.name]);

	return (
		<Shell view={view} onNavigate={setView}>
			{view.name === "home" && <HomePage onNavigate={setView} />}
			{view.name === "editor" && (
				<CampaignEditorPage
					campaignId={view.campaignId}
					onNavigate={setView}
					onBack={() => setView({ name: "home" })}
				/>
			)}
			{view.name === "progress" && (
				<ProgressPage campaignId={view.campaignId} onNavigate={setView} />
			)}
			{view.name === "settings" && <SettingsPage onNavigate={setView} />}
			{view.name === "about" && <AboutPage onNavigate={setView} />}
		</Shell>
	);
}
