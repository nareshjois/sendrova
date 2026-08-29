/** Worker environment bindings. */
export interface Env {
	SMS_BUCKET: R2Bucket;
	TOKEN_SIGNING_KEY: string;
}

export type PairStatus = "pending" | "paired" | "expired";
export type JobStatus = "pending" | "in_progress" | "sent" | "failed";

export interface PairRecord {
	pairId: string;
	secretHash: string;
	desktopTokenHash: string;
	status: PairStatus;
	expiresAt: string;
	createdAt: string;
	deviceId?: string;
	redeemedAt?: string;
}

export interface DeviceMeta {
	deviceId: string;
	pairId: string;
	deviceTokenHash: string;
	desktopTokenHash: string;
	pairedAt: string;
	lastSeenAt: string | null;
}

export interface JobRecord {
	jobId: string;
	deviceId: string;
	clientJobId: string;
	to: string;
	body: string;
	status: JobStatus;
	error: string | null;
	createdAt: string;
	updatedAt: string;
	leaseExpiresAt: string | null;
}

export type TokenRole = "desktop" | "device";

export interface TokenClaims {
	role: TokenRole;
	/** pairId for desktop; deviceId for device */
	sub: string;
	nonce: string;
}
