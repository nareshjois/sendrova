(() => {
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
	if (reduced.matches) return;

	const far = document.querySelector('[data-parallax="far"]');
	const mid = document.querySelector('[data-parallax="mid"]');
	const near = document.querySelector('[data-parallax="near"]');
	const logo = document.querySelector('[data-parallax="logo"]');
	if (!far || !mid || !near || !logo) return;

	let targetX = 0;
	let targetY = 0;
	let currentX = 0;
	let currentY = 0;
	let raf = 0;

	const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

	const apply = () => {
		currentX += (targetX - currentX) * 0.08;
		currentY += (targetY - currentY) * 0.08;

		far.style.transform = `translate3d(${currentX * -2.4}%, ${currentY * -2.4}%, 0)`;
		mid.style.transform = `translate3d(${currentX * -3.2}%, ${currentY * -3.2}%, 0)`;
		near.style.transform = `translate3d(${currentX * 3.6}%, ${currentY * 3.6}%, 0)`;
		logo.style.transform = `translate3d(${currentX * 1.6}%, ${currentY * 1.6}%, 0) rotate(${currentX * 0.35}deg)`;

		if (
			Math.abs(targetX - currentX) > 0.01 ||
			Math.abs(targetY - currentY) > 0.01
		) {
			raf = requestAnimationFrame(apply);
		} else {
			raf = 0;
		}
	};

	const schedule = () => {
		if (!raf) raf = requestAnimationFrame(apply);
	};

	const onPointer = (event) => {
		const x = (event.clientX / window.innerWidth) * 2 - 1;
		const y = (event.clientY / window.innerHeight) * 2 - 1;
		targetX = clamp(x, -1, 1) * 1.2;
		targetY = clamp(y, -1, 1) * 1.2;
		schedule();
	};

	const onScroll = () => {
		const y = window.scrollY / Math.max(window.innerHeight, 1);
		targetY = clamp(y, 0, 1.5) * 1.4;
		schedule();
	};

	window.addEventListener("pointermove", onPointer, { passive: true });
	window.addEventListener("scroll", onScroll, { passive: true });
})();
