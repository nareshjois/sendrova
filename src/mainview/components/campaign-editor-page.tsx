import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FooterActions } from "@/components/footer-actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { AppView } from "@/lib/app-nav";
import { electrobun } from "@/lib/electrobun";
import { cn } from "@/lib/utils";
import {
	AlertCircle,
	CheckCircle2,
	CircleDashed,
	PlusCircle,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	CampaignDTO,
	DeliveryStatus,
	ImportResultDTO,
	ImportRowDTO,
	TemplateValidationDTO,
} from "shared/rpc";

const DEFAULT_TEMPLATE =
	"Hi {{name}}, thanks for your enquiry from {{city}}.";

const STATUS_ORDER: Record<DeliveryStatus, number> = {
	new: 0,
	pending: 1,
	failed: 2,
	sent: 3,
	invalid: 4,
};

function DeliveryStatusCell({
	status,
	error,
}: {
	status?: DeliveryStatus;
	error?: string;
}) {
	const resolved = status ?? (error ? "invalid" : "pending");
	const base =
		"inline-flex items-center gap-1.5 text-xs font-medium";
	switch (resolved) {
		case "new":
			return (
				<span className={cn(base, "text-teal-700 dark:text-teal-400")}>
					<PlusCircle className="size-3.5 shrink-0" aria-hidden />
					New
				</span>
			);
		case "sent":
			return (
				<span className={cn(base, "text-[var(--success)]")}>
					<CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
					Sent
				</span>
			);
		case "failed":
			return (
				<span className={cn(base, "text-destructive")} title={error}>
					<AlertCircle className="size-3.5 shrink-0" aria-hidden />
					Failed
				</span>
			);
		case "invalid":
			return (
				<span className={cn(base, "text-destructive")} title={error}>
					<XCircle className="size-3.5 shrink-0" aria-hidden />
					{error ?? "Invalid"}
				</span>
			);
		default:
			return (
				<span className={cn(base, "text-muted-foreground")}>
					<CircleDashed className="size-3.5 shrink-0" aria-hidden />
					Pending
				</span>
			);
	}
}

function detectFormat(filename: string, text: string): "csv" | "txt" {
	const lower = filename.toLowerCase();
	if (lower.endsWith(".csv")) return "csv";
	if (lower.endsWith(".txt")) return "txt";
	const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
	return firstLine.includes(",") ? "csv" : "txt";
}

function readFileAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result;
			if (typeof result !== "string") {
				reject(new Error("Failed to read file"));
				return;
			}
			const comma = result.indexOf(",");
			resolve(comma >= 0 ? result.slice(comma + 1) : result);
		};
		reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
		reader.readAsDataURL(file);
	});
}

export function CampaignEditorPage({
	campaignId: initialCampaignId,
	onNavigate,
	onBack,
}: {
	campaignId: string | null;
	onNavigate: (v: AppView) => void;
	onBack: () => void;
}) {
	const [campaignId, setCampaignId] = useState<string | null>(initialCampaignId);
	const [name, setName] = useState("Untitled campaign");
	const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
	const [pasteText, setPasteText] = useState("");
	const [sourceFilename, setSourceFilename] = useState<string | undefined>();
	const [importResult, setImportResult] = useState<ImportResultDTO | null>(null);
	const [validation, setValidation] = useState<TemplateValidationDTO | null>(
		null,
	);
	const [preview, setPreview] = useState("");
	const [mediaKind, setMediaKind] = useState<"none" | "image" | "video">("none");
	const [mediaPreview, setMediaPreview] = useState<{
		mime: string;
		base64: string;
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const [booting, setBooting] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const rows = importResult?.rows ?? [];
	const columns = importResult?.columns ?? [];
	const displayColumns = useMemo(
		() =>
			columns
				.filter((c) => {
					const lower = c.toLowerCase();
					if (lower === "phone" || lower === "phone_raw") return false;
					if (importResult?.phoneColumn && c === importResult.phoneColumn) {
						return false;
					}
					return true;
				})
				.slice(0, 4),
		[columns, importResult?.phoneColumn],
	);
	const displayRows = useMemo(
		() =>
			[...rows].sort((a, b) => {
				const aStatus = a.deliveryStatus ?? (a.valid ? "pending" : "invalid");
				const bStatus = b.deliveryStatus ?? (b.valid ? "pending" : "invalid");
				return STATUS_ORDER[aStatus] - STATUS_ORDER[bStatus];
			}),
		[rows],
	);
	const firstValid = useMemo(
		() => displayRows.find((r) => r.valid && r.deliveryStatus !== "sent"),
		[displayRows],
	);

	const applyCampaign = useCallback((c: CampaignDTO) => {
		setCampaignId(c.id);
		setName(c.name);
		setTemplate(c.template_text || DEFAULT_TEMPLATE);
		setMediaKind(c.media_kind);
		if (c.source_filename) setSourceFilename(c.source_filename);
	}, []);

	useEffect(() => {
		let cancelled = false;

		async function boot() {
			setBooting(true);
			setError(null);
			try {
				if (initialCampaignId) {
					const detail = await electrobun.rpc!.request.getCampaign({
						id: initialCampaignId,
					});
					if (cancelled || !detail) {
						if (!cancelled && !detail) setError("Campaign not found");
						return;
					}
					applyCampaign(detail.campaign);
					const asImport: ImportResultDTO = {
						rows: detail.contacts.map(
							(c): ImportRowDTO => ({
								phone: c.phone,
								phoneRaw: c.phone_raw,
								fields: c.fields,
								valid: c.valid,
								error: c.error ?? undefined,
								deliveryStatus: c.deliveryStatus,
							}),
						),
						columns: (() => {
							const keys = new Set<string>(["phone"]);
							for (const c of detail.contacts) {
								for (const k of Object.keys(c.fields)) keys.add(k);
							}
							return [...keys];
						})(),
						phoneColumn: "phone",
						invalidCount: detail.contacts.filter((c) => !c.valid).length,
						duplicateCount: 0,
						newCount: 0,
						alreadySentCount: detail.contacts.filter(
							(c) => c.deliveryStatus === "sent",
						).length,
					};
					setImportResult(asImport);
					if (detail.campaign.media_kind !== "none") {
						const previewMedia =
							await electrobun.rpc!.request.readMediaPreview({
								campaignId: detail.campaign.id,
							});
						if (!cancelled) setMediaPreview(previewMedia);
					}
				} else {
					const created = await electrobun.rpc!.request.createCampaign({
						name: "Untitled campaign",
						templateText: DEFAULT_TEMPLATE,
					});
					if (cancelled) return;
					applyCampaign(created);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			} finally {
				if (!cancelled) setBooting(false);
			}
		}

		void boot();
		return () => {
			cancelled = true;
		};
	}, [initialCampaignId, applyCampaign]);

	useEffect(() => {
		if (!importResult || !template.trim()) {
			setValidation(null);
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			electrobun.rpc?.request
				.validateTemplate({ template, columns: importResult.columns })
				.then((v) => {
					if (!cancelled) setValidation(v);
				})
				.catch(() => undefined);
		}, 250);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [template, importResult]);

	useEffect(() => {
		if (!firstValid || !template.trim()) {
			setPreview("");
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			electrobun.rpc?.request
				.previewTemplate({ template, fields: firstValid.fields })
				.then((r) => {
					if (!cancelled) setPreview(r.text);
				})
				.catch(() => undefined);
		}, 250);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [template, firstValid]);

	async function runImport(text: string, format: "csv" | "txt", filename?: string) {
		setBusy(true);
		setError(null);
		try {
			const parsed = await electrobun.rpc!.request.importText({ text, format });
			if (campaignId) {
				const merged = await electrobun.rpc!.request.previewMergedContacts({
					campaignId,
					rows: parsed.rows,
				});
				setImportResult(merged);
			} else {
				setImportResult(parsed);
			}
			if (filename) setSourceFilename(filename);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	async function handleFileImport(file: File) {
		const text = await file.text();
		await runImport(text, detectFormat(file.name, text), file.name);
	}

	async function save(): Promise<boolean> {
		if (!campaignId) return false;
		setBusy(true);
		setError(null);
		try {
			await electrobun.rpc!.request.updateCampaign({
				id: campaignId,
				name: name.trim() || "Untitled campaign",
				templateText: template,
				sourceFilename: sourceFilename ?? null,
			});
			if (importResult) {
				await electrobun.rpc!.request.setCampaignContacts({
					campaignId,
					rows: importResult.rows,
					sourceFilename,
				});
			}
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return false;
		} finally {
			setBusy(false);
		}
	}

	async function handleStart() {
		if (!campaignId) return;
		const ok = await save();
		if (!ok) return;
		setBusy(true);
		try {
			await electrobun.rpc!.request.startCampaign({ id: campaignId });
			onNavigate({ name: "progress", campaignId });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	async function handleMedia(file: File | null) {
		if (!campaignId || !file) return;
		setBusy(true);
		setError(null);
		try {
			const base64 = await readFileAsBase64(file);
			const updated = await electrobun.rpc!.request.setCampaignMedia({
				campaignId,
				filename: file.name,
				base64,
			});
			setMediaKind(updated.media_kind);
			const previewMedia = await electrobun.rpc!.request.readMediaPreview({
				campaignId,
			});
			setMediaPreview(previewMedia);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	async function clearMedia() {
		if (!campaignId) return;
		setBusy(true);
		setError(null);
		try {
			const updated = await electrobun.rpc!.request.clearCampaignMedia({
				campaignId,
			});
			setMediaKind(updated.media_kind);
			setMediaPreview(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	if (booting) {
		return (
			<div className="p-6 text-sm text-muted-foreground">Preparing campaign…</div>
		);
	}

	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto p-6">
				<div className="mx-auto flex max-w-6xl flex-col gap-5">
					<div className="flex flex-wrap items-end justify-between gap-4">
						<div className="min-w-0 flex-1 space-y-1">
							<h1 className="text-2xl font-semibold tracking-tight">
								{initialCampaignId ? "Edit campaign" : "New campaign"}
							</h1>
							<p className="text-sm text-muted-foreground">
								Template, contacts, and optional media
							</p>
						</div>
						<div className="w-full max-w-sm space-y-2 sm:w-72">
							<Label htmlFor="campaign-name">Name</Label>
							<Input
								id="campaign-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Campaign name"
							/>
						</div>
					</div>

					{error && (
						<Alert variant="destructive">
							<AlertTitle>Error</AlertTitle>
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}

					<div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
						{/* Left: message, media, preview */}
						<div className="space-y-5">
							<div className="space-y-2">
								<Label htmlFor="template">Message template</Label>
								<Textarea
									id="template"
									rows={8}
									value={template}
									onChange={(e) => setTemplate(e.target.value)}
									placeholder="Hi {{name}}, …"
									className="font-mono text-sm"
								/>
								{validation &&
									!validation.ok &&
									validation.unknown.length > 0 && (
										<Alert>
											<AlertTitle>Unknown placeholders</AlertTitle>
											<AlertDescription>
												{validation.unknown.map((u) => `{{${u}}}`).join(", ")}{" "}
												— not in imported columns.
											</AlertDescription>
										</Alert>
									)}
							</div>

							<Card>
								<CardHeader className="pb-3">
									<CardTitle className="text-base">Media</CardTitle>
								</CardHeader>
								<CardContent className="space-y-3">
									<div className="flex flex-wrap items-center gap-2">
										<label
											className={`inline-flex cursor-pointer ${busy || !campaignId ? "pointer-events-none opacity-50" : ""}`}
										>
											<span className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground">
												Attach image / video
											</span>
											<input
												type="file"
												accept="image/*,video/*"
												className="sr-only"
												disabled={busy || !campaignId}
												onChange={(e) => {
													const file = e.target.files?.[0] ?? null;
													void handleMedia(file);
													e.target.value = "";
												}}
											/>
										</label>
										{mediaKind !== "none" && (
											<Button
												size="sm"
												variant="ghost"
												disabled={busy}
												onClick={() => void clearMedia()}
											>
												Clear media
											</Button>
										)}
										<span className="text-xs text-muted-foreground capitalize">
											{mediaKind === "none" ? "No media" : mediaKind}
										</span>
									</div>
									{mediaPreview && (
										<div className="overflow-hidden rounded-md border bg-muted/30 p-2">
											{mediaPreview.mime.startsWith("video/") ? (
												<video
													controls
													className="max-h-48 max-w-full"
													src={`data:${mediaPreview.mime};base64,${mediaPreview.base64}`}
												/>
											) : (
												<img
													alt="Campaign media preview"
													className="max-h-48 max-w-full object-contain"
													src={`data:${mediaPreview.mime};base64,${mediaPreview.base64}`}
												/>
											)}
										</div>
									)}
								</CardContent>
							</Card>

							{preview && (
								<Card>
									<CardHeader className="pb-2">
										<CardTitle className="text-base">Preview</CardTitle>
									</CardHeader>
									<CardContent>
										<p className="whitespace-pre-wrap text-sm">{preview}</p>
										{firstValid && (
											<p className="mt-2 font-mono text-xs text-muted-foreground">
												First contact: {firstValid.phone}
											</p>
										)}
									</CardContent>
								</Card>
							)}
						</div>

						{/* Right: contacts */}
						<div className="space-y-5">
							<Card>
								<CardHeader className="pb-3">
									<CardTitle className="text-base">Contacts</CardTitle>
								</CardHeader>
								<CardContent className="space-y-3">
									<div className="space-y-2">
										<Label htmlFor="paste">Paste CSV / TXT</Label>
										<Textarea
											id="paste"
											rows={8}
											value={pasteText}
											onChange={(e) => setPasteText(e.target.value)}
											placeholder="phone,name,city…"
											className="font-mono text-xs"
										/>
										<div className="flex flex-wrap gap-2">
											<Button
												size="sm"
												disabled={busy || !pasteText.trim()}
												onClick={() =>
													runImport(
														pasteText,
														detectFormat("paste.csv", pasteText),
														sourceFilename ?? "paste.csv",
													)
												}
											>
												Import paste
											</Button>
											<label className="inline-flex cursor-pointer">
												<span className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground">
													Import file
												</span>
												<input
													type="file"
													accept=".csv,.txt,text/csv,text/plain"
													className="sr-only"
													onChange={(e) => {
														const file = e.target.files?.[0];
														if (file) void handleFileImport(file);
														e.target.value = "";
													}}
												/>
											</label>
										</div>
									</div>

									{importResult && (
										<>
											<p className="text-xs text-muted-foreground">
												{rows.length} contacts
												{typeof importResult.newCount === "number" &&
												importResult.newCount > 0
													? ` · ${importResult.newCount} new`
													: ""}
												{typeof importResult.alreadySentCount === "number" &&
												importResult.alreadySentCount > 0
													? ` · ${importResult.alreadySentCount} already sent`
													: ""}
												{importResult.invalidCount > 0
													? ` · ${importResult.invalidCount} invalid`
													: ""}
												{importResult.duplicateCount > 0
													? ` · ${importResult.duplicateCount} duplicates cleaned`
													: ""}
												{sourceFilename ? ` · ${sourceFilename}` : ""}
											</p>
											<ScrollArea className="h-72 rounded-md border">
												<Table>
													<TableHeader>
														<TableRow>
															<TableHead>Phone</TableHead>
															{displayColumns.map((col) => (
																<TableHead key={col}>{col}</TableHead>
															))}
															<TableHead>Status</TableHead>
														</TableRow>
													</TableHeader>
													<TableBody>
														{displayRows.map((row, i) => (
															<TableRow
																key={`${row.phoneRaw}-${row.phone}-${i}`}
															>
																<TableCell className="font-mono text-xs">
																	{row.phone || row.phoneRaw}
																</TableCell>
																{displayColumns.map((col) => (
																	<TableCell key={col} className="text-xs">
																		{row.fields[col] ?? ""}
																	</TableCell>
																))}
																<TableCell>
																	<DeliveryStatusCell
																		status={row.deliveryStatus}
																		error={row.error}
																	/>
																</TableCell>
															</TableRow>
														))}
													</TableBody>
												</Table>
											</ScrollArea>
										</>
									)}
								</CardContent>
							</Card>
						</div>
					</div>
				</div>
			</div>

			<FooterActions>
				<Button variant="ghost" disabled={busy} onClick={onBack}>
					Cancel
				</Button>
				<Button
					variant="outline"
					disabled={busy || !campaignId}
					onClick={() => void save()}
				>
					Save
				</Button>
				<Button
					disabled={busy || !campaignId || !firstValid}
					onClick={() => void handleStart()}
				>
					Start
				</Button>
			</FooterActions>
		</>
	);
}
