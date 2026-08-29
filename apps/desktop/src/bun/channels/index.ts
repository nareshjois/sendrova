import { SmsRelayChannel } from "./sms-relay-channel";
import type { MessageChannel, MessageChannelKind } from "./types";
import { WhatsAppChannel } from "./whatsapp-channel";

export type { MessageChannel, MessageChannelKind, SendMessageInput, SendMessageResult } from "./types";
export { WhatsAppChannel, WhatsAppNotOnNetworkError } from "./whatsapp-channel";
export {
	SmsRelayChannel,
	startSmsPairing,
	refreshSmsPairStatus,
	fetchSmsDeviceHealth,
	unpairSms,
	getSmsJobStatus,
	buildSmsQrPayload,
	clearMockJobsForTests,
} from "./sms-relay-channel";
export {
	readSmsRelayState,
	writeSmsRelayState,
	clearSmsRelayState,
	isSmsMockMode,
	resolveSmsRelayBaseUrl,
} from "./sms-relay-store";
export {
	SMS_RELAY_PRODUCTION_BASE_URL,
	isSmsRelayMockEnv,
	smsRelayEnvBaseUrlOverride,
} from "./sms-relay-config";

const whatsapp = new WhatsAppChannel();
const sms = new SmsRelayChannel();

export function getMessageChannel(kind: MessageChannelKind): MessageChannel {
	return kind === "sms" ? sms : whatsapp;
}
