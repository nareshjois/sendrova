import type { MediaKind } from "../db";

export type MessageChannelKind = "whatsapp" | "sms";

export type SendMessageInput = {
	/** Destination phone (digits / E.164 without + preferred). */
	to: string;
	body: string;
	mediaKind?: MediaKind;
	mediaPath?: string | null;
	/** Desktop idempotency key (attempt id). */
	clientJobId: string;
};

export type SendMessageResult = {
	/**
	 * Remote job id from the SMS relay (or mock).
	 * WhatsApp leaves this undefined.
	 */
	remoteJobId?: string;
};

export type WaitUntilSentOpts = {
	signal?: AbortSignal;
	/** Poll interval for remote job status (default 1.5s). */
	pollIntervalMs?: number;
	/** Give up waiting for phone ack (default 120s). */
	timeoutMs?: number;
};

/**
 * Outbound delivery adapter for a campaign channel.
 *
 * SMS: `send` enqueues only; scheduler must `waitUntilSent` until phone ack
 * before marking the attempt sent.
 */
export interface MessageChannel {
	readonly kind: MessageChannelKind;
	isReady(): boolean | Promise<boolean>;
	send(input: SendMessageInput): Promise<SendMessageResult>;
	waitUntilSent?(
		remoteJobId: string,
		opts?: WaitUntilSentOpts,
	): Promise<void>;
}
