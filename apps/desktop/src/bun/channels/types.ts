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

/**
 * Outbound delivery adapter for a campaign channel.
 *
 * Phase 1: SMS may treat enqueue (or mock accept) as success.
 * Phase 2: SmsRelayChannel.waitUntilSent polls until phone ack before
 * the scheduler marks the attempt sent.
 */
export interface MessageChannel {
	readonly kind: MessageChannelKind;
	isReady(): boolean | Promise<boolean>;
	send(input: SendMessageInput): Promise<SendMessageResult>;
	waitUntilSent?(
		remoteJobId: string,
		opts?: { signal?: AbortSignal },
	): Promise<void>;
}
