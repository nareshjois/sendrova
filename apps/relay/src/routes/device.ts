import { requireDesktopAuth } from "../auth";
import { ONLINE_FRESHNESS_MS } from "../constants";
import { ApiError, json } from "../errors";
import type { Env } from "../types";

export async function handleDeviceHealth(env: Env, req: Request): Promise<Response> {
	const auth = await requireDesktopAuth(env, req);
	if (!auth.device || auth.pair.status !== "paired") {
		throw new ApiError(404, "NO_DEVICE", "No paired device for this desktop session");
	}

	const lastSeenAt = auth.device.lastSeenAt;
	let online = false;
	if (lastSeenAt) {
		const age = Date.now() - Date.parse(lastSeenAt);
		online = Number.isFinite(age) && age >= 0 && age <= ONLINE_FRESHNESS_MS;
	}

	return json({ online, lastSeenAt });
}
