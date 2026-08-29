import { Electroview } from "electrobun/view";
import type { CampaignProgressDTO, ConnectionStatus, MainRPC } from "shared/rpc";

type ConnectionStatusListener = (status: ConnectionStatus) => void;
type QrListener = (qr: string) => void;
type ProgressListener = (progress: CampaignProgressDTO) => void;
type DashboardListener = () => void;

const connectionStatusListeners = new Set<ConnectionStatusListener>();
const qrListeners = new Set<QrListener>();
const progressListeners = new Set<ProgressListener>();
const dashboardListeners = new Set<DashboardListener>();

const rpc = Electroview.defineRPC<MainRPC>({
	maxRequestTime: 120_000,
	handlers: {
		requests: {},
		messages: {
			connectionStatus: ({ status }) => {
				for (const listener of connectionStatusListeners) listener(status);
			},
			qr: ({ qr }) => {
				for (const listener of qrListeners) listener(qr);
			},
			progress: (progress) => {
				for (const listener of progressListeners) listener(progress);
			},
			dashboardChanged: () => {
				for (const listener of dashboardListeners) listener();
			},
		},
	},
});

export const electrobun = new Electroview({ rpc });

export function onConnectionStatus(listener: ConnectionStatusListener): () => void {
	connectionStatusListeners.add(listener);
	return () => connectionStatusListeners.delete(listener);
}

export function onQr(listener: QrListener): () => void {
	qrListeners.add(listener);
	return () => qrListeners.delete(listener);
}

export function onProgress(listener: ProgressListener): () => void {
	progressListeners.add(listener);
	return () => progressListeners.delete(listener);
}

export function onDashboardChanged(listener: DashboardListener): () => void {
	dashboardListeners.add(listener);
	return () => dashboardListeners.delete(listener);
}
