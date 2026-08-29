import {
	createContext,
	useContext,
	useLayoutEffect,
	useState,
	type ReactNode,
	type RefObject,
} from "react";
import { createPortal } from "react-dom";

const FooterSlotContext = createContext<RefObject<HTMLDivElement | null> | null>(
	null,
);

export function FooterSlotProvider({
	slotRef,
	children,
}: {
	slotRef: RefObject<HTMLDivElement | null>;
	children: ReactNode;
}) {
	return (
		<FooterSlotContext.Provider value={slotRef}>
			{children}
		</FooterSlotContext.Provider>
	);
}

export function FooterActions({ children }: { children: ReactNode }) {
	const slotRef = useContext(FooterSlotContext);
	const [target, setTarget] = useState<HTMLDivElement | null>(null);

	useLayoutEffect(() => {
		const node = slotRef?.current ?? null;
		setTarget(node);
		if (node) return;

		// Slot may commit after this child on first paint — retry once.
		const id = requestAnimationFrame(() => {
			setTarget(slotRef?.current ?? null);
		});
		return () => cancelAnimationFrame(id);
	}, [slotRef]);

	if (!target) return null;
	return createPortal(children, target);
}
