import type { MediaKind } from "../db";
import {
	getStatus,
	resolveJid,
	sendImage,
	sendText,
	sendVideo,
} from "../whatsapp-session";
import type {
	MessageChannel,
	SendMessageInput,
	SendMessageResult,
} from "./types";

async function sendWithMedia(
	jid: string,
	body: string,
	mediaKind: MediaKind,
	mediaPath: string | null | undefined,
): Promise<void> {
	if (mediaKind === "image" && mediaPath) {
		await sendImage(jid, mediaPath, body);
		return;
	}
	if (mediaKind === "video" && mediaPath) {
		await sendVideo(jid, mediaPath, body);
		return;
	}
	await sendText(jid, body);
}

export class WhatsAppChannel implements MessageChannel {
	readonly kind = "whatsapp" as const;

	isReady(): boolean {
		return getStatus() === "connected";
	}

	async send(input: SendMessageInput): Promise<SendMessageResult> {
		const jid = await resolveJid(input.to);
		if (!jid) {
			throw new WhatsAppNotOnNetworkError(input.to);
		}
		await sendWithMedia(
			jid,
			input.body,
			input.mediaKind ?? "none",
			input.mediaPath,
		);
		return {};
	}
}

export class WhatsAppNotOnNetworkError extends Error {
	constructor(phone: string) {
		super(`not on WhatsApp (${phone})`);
		this.name = "WhatsAppNotOnNetworkError";
	}
}
