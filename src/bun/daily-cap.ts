import {
	countSentTodayLocal,
	getAllSettings,
	localDayBounds,
	setSetting,
} from "./db";

export type DayBounds = {
	startIso: string;
	endIso: string;
	nextMidnightIso: string;
};

type LimitIncreasedListener = (prev: number, next: number) => void;

const limitIncreasedListeners = new Set<LimitIncreasedListener>();

export function getLocalDayBounds(now: Date = new Date()): DayBounds {
	return localDayBounds(now);
}

export function getSentToday(now: Date = new Date()): number {
	return countSentTodayLocal(now);
}

export function getRemainingToday(now: Date = new Date()): number {
	const cap = getAllSettings().max_messages_per_day;
	return Math.max(0, cap - getSentToday(now));
}

export function isCapHit(now: Date = new Date()): boolean {
	return getRemainingToday(now) <= 0;
}

/**
 * Pre-send gate: returns true when at least one send slot remains today.
 * Actual consumption happens when an attempt is marked `sent`.
 */
export function tryConsume(now: Date = new Date()): boolean {
	return getRemainingToday(now) > 0;
}

/** Register a hook fired when max_messages_per_day increases via setMaxMessagesPerDay. */
export function onLimitIncreased(listener: LimitIncreasedListener): () => void {
	limitIncreasedListeners.add(listener);
	return () => limitIncreasedListeners.delete(listener);
}

/** Update daily cap; notifies listeners when the limit increases. */
export function setMaxMessagesPerDay(next: number): void {
	const prev = getAllSettings().max_messages_per_day;
	setSetting("max_messages_per_day", next);
	if (next > prev) {
		for (const listener of limitIncreasedListeners) {
			try {
				listener(prev, next);
			} catch (err) {
				console.error("[daily-cap] onLimitIncreased error", err);
			}
		}
	}
}
