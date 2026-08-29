import { rmSync } from "node:fs";
import { Boom } from "@hapi/boom";
import makeWASocket, {
	DisconnectReason,
	makeCacheableSignalKeyStore,
	useMultiFileAuthState,
	type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { getAuthDir } from "./paths";

export type SessionStatus =
	| "disconnected"
	| "qr"
	| "connecting"
	| "connected"
	| "logged_out";

export type StatusListener = (status: SessionStatus) => void;
export type QrListener = (qr: string) => void;

const logger = pino({ level: "silent" });

let sock: WASocket | null = null;
let status: SessionStatus = "disconnected";
let starting = false;
let shouldReconnect = true;

const statusListeners = new Set<StatusListener>();
const qrListeners = new Set<QrListener>();

function setStatus(next: SessionStatus): void {
	if (status === next) return;
	status = next;
	for (const listener of statusListeners) {
		try {
			listener(next);
		} catch (err) {
			console.error("[whatsapp-session] onStatus error", err);
		}
	}
}

function emitQr(qr: string): void {
	for (const listener of qrListeners) {
		try {
			listener(qr);
		} catch (err) {
			console.error("[whatsapp-session] onQr error", err);
		}
	}
}

export function onStatus(listener: StatusListener): () => void {
	statusListeners.add(listener);
	return () => statusListeners.delete(listener);
}

export function onQr(listener: QrListener): () => void {
	qrListeners.add(listener);
	return () => qrListeners.delete(listener);
}

export function getStatus(): SessionStatus {
	return status;
}

export function getSocket(): WASocket | null {
	return sock;
}

/**
 * Start (or restart) the Baileys session using multi-file auth under getAuthDir().
 * Follows the official reconnect example from baileys.wiki.
 */
export async function start(): Promise<void> {
	if (starting) return;
	starting = true;
	shouldReconnect = true;

	try {
		await connectToWhatsApp();
	} finally {
		starting = false;
	}
}

async function connectToWhatsApp(): Promise<void> {
	const authDir = getAuthDir();
	const { state, saveCreds } = await useMultiFileAuthState(authDir);

	setStatus("connecting");

	const socket = makeWASocket({
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		logger,
		printQRInTerminal: false,
	});

	sock = socket;

	socket.ev.on("creds.update", saveCreds);

	socket.ev.on("connection.update", (update) => {
		const { connection, lastDisconnect, qr } = update;

		if (qr) {
			setStatus("qr");
			emitQr(qr);
		}

		if (connection === "open") {
			setStatus("connected");
			return;
		}

		if (connection === "connecting") {
			if (status !== "qr") setStatus("connecting");
			return;
		}

		if (connection === "close") {
			const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
				?.statusCode;
			const loggedOut = statusCode === DisconnectReason.loggedOut;

			sock = null;

			if (loggedOut) {
				shouldReconnect = false;
				setStatus("logged_out");
				console.log(
					"[whatsapp-session] Logged out. Clear auth and re-scan to reconnect.",
				);
				return;
			}

			setStatus("disconnected");

			if (shouldReconnect) {
				void connectToWhatsApp().catch((err) => {
					console.error("[whatsapp-session] reconnect failed", err);
					setStatus("disconnected");
				});
			}
		}
	});
}

/** Logout, wipe auth files, and reset status */
export async function logout(): Promise<void> {
	shouldReconnect = false;
	const current = sock;
	sock = null;

	try {
		if (current) {
			await current.logout();
		}
	} catch (err) {
		console.warn("[whatsapp-session] logout() on socket failed", err);
	}

	try {
		current?.end(undefined);
	} catch {
		// ignore
	}

	try {
		rmSync(getAuthDir(), { recursive: true, force: true });
	} catch (err) {
		console.warn("[whatsapp-session] failed to remove auth dir", err);
	}

	// Recreate empty auth dir for the next start()
	getAuthDir();
	setStatus("logged_out");
}

function requireConnectedSocket(): WASocket {
	const current = sock;
	if (!current || status !== "connected") {
		throw new Error("WhatsApp session is not connected");
	}
	return current;
}

/** Send a plain text message via the active socket */
export async function sendText(jid: string, text: string) {
	return requireConnectedSocket().sendMessage(jid, { text });
}

/** Send an image from a local file path with optional caption */
export async function sendImage(
	jid: string,
	filePath: string,
	caption?: string,
) {
	return requireConnectedSocket().sendMessage(jid, {
		image: { url: filePath },
		caption,
	});
}

/** Send a video from a local file path with optional caption */
export async function sendVideo(
	jid: string,
	filePath: string,
	caption?: string,
) {
	return requireConnectedSocket().sendMessage(jid, {
		video: { url: filePath },
		caption,
	});
}

/** True if the digits-only phone number is registered on WhatsApp */
export async function checkOnWhatsApp(phoneDigits: string): Promise<boolean> {
	const current = sock;
	if (!current || status !== "connected") {
		throw new Error("WhatsApp session is not connected");
	}
	const digits = phoneDigits.replace(/\D/g, "");
	if (!digits) return false;

	const results = await current.onWhatsApp(digits);
	return Boolean(results?.[0]?.exists);
}

/** Resolve digits to a WhatsApp JID, or null if not on WhatsApp */
export async function resolveJid(phoneDigits: string): Promise<string | null> {
	const current = sock;
	if (!current || status !== "connected") {
		throw new Error("WhatsApp session is not connected");
	}
	const digits = phoneDigits.replace(/\D/g, "");
	if (!digits) return null;

	const results = await current.onWhatsApp(digits);
	const hit = results?.[0];
	if (!hit?.exists) return null;
	return hit.jid ?? `${digits}@s.whatsapp.net`;
}
