/**
 * Finance Agent Extension
 *
 * Adds conservative finance-analysis guidance, finance-specific tools, protected
 * paths, command restrictions, and finance resource discovery without changing
 * core coding-agent behavior.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const baseDir = dirname(fileURLToPath(import.meta.url));
const financeResourceDir = join(baseDir, "finance-agent");

const SENSITIVE_PATH_PATTERNS = [
	/(^|[/\\])\.env($|[./\\])/i,
	/(^|[/\\])\.git($|[/\\])/i,
	/(^|[/\\])(credentials?|secrets?|private[-_]?keys?)([/\\]|$)/i,
	/(^|[/\\]).*(secret|credential|token|password|private[-_]?key).*/i,
	/(^|[/\\])(raw|original|source)[-_]?(statements?|transactions?|backups?)([/\\]|$)/i,
];

const FINANCE_CONTEXT_FILES = ["FINANCE.md", "ACCOUNTING_RULES.md", "CHART_OF_ACCOUNTS.md", "REPORTING_POLICY.md"];

const DANGEROUS_COMMAND_PATTERNS = [
	/\brm\s+(-[^\n;|&]*r|-[^\n;|&]*f|-[^\n;|&]*rf|-[^\n;|&]*fr)\b/i,
	/\b(shred|srm|mkfs|dd)\b/i,
	/\b(curl|wget|scp|sftp|rsync|nc|ncat|ftp)\b/i,
	/\b(git\s+push|gh\s+repo|gh\s+pr\s+create)\b/i,
	/>\s*(?:\/dev\/|[^&|;]*\.(?:env|pem|key|p12|pfx)\b)/i,
];

interface CsvData {
	headers: string[];
	rows: Record<string, string>[];
}

interface MoneyValue {
	value: number;
	raw: string;
	valid: boolean;
}

interface Evidence {
	path: string;
	line: number;
	message: string;
}

function isSensitivePath(path: string): boolean {
	return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function assertSafeInputPath(path: string): string {
	if (!path.trim()) {
		throw new Error("A file path is required.");
	}

	if (isSensitivePath(path)) {
		throw new Error(`Refusing to read protected finance path: ${path}`);
	}

	return resolve(process.cwd(), path);
}

function parseCsv(text: string): CsvData {
	const rows: string[][] = [];
	let field = "";
	let row: string[] = [];
	let quoted = false;

	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		const next = text[index + 1];

		if (quoted) {
			if (char === '"' && next === '"') {
				field += '"';
				index++;
			} else if (char === '"') {
				quoted = false;
			} else {
				field += char;
			}
			continue;
		}

		if (char === '"') {
			quoted = true;
		} else if (char === ",") {
			row.push(field);
			field = "";
		} else if (char === "\n") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else if (char !== "\r") {
			field += char;
		}
	}

	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	const [headerRow = [], ...dataRows] = rows.filter((values) => values.some((value) => value.trim().length > 0));
	const headers = headerRow.map((header, index) => header.trim() || `column_${index + 1}`);

	return {
		headers,
		rows: dataRows.map((values) =>
			Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])),
		),
	};
}

async function loadCsv(path: string): Promise<CsvData & { absolutePath: string }> {
	const absolutePath = assertSafeInputPath(path);
	const text = await readFile(absolutePath, "utf8");
	const csv = parseCsv(text);
	return { ...csv, absolutePath };
}

function parseMoney(raw: string): MoneyValue {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { value: 0, raw, valid: false };
	}

	const negative = /^\(.*\)$/.test(trimmed) || /^-/.test(trimmed);
	const normalized = trimmed.replace(/[(),\s$€£¥]/g, "").replace(/^-/, "");
	const value = Number(normalized);

	return Number.isFinite(value)
		? { value: negative ? -value : value, raw, valid: true }
		: { value: 0, raw, valid: false };
}

function formatMoney(value: number): string {
	return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function getColumn(headers: string[], preferred: string | undefined, candidates: string[]): string | undefined {
	if (preferred && headers.includes(preferred)) {
		return preferred;
	}

	const lower = new Map(headers.map((header) => [header.toLowerCase(), header]));
	return candidates
		.map((candidate) => lower.get(candidate.toLowerCase()))
		.find((candidate): candidate is string => Boolean(candidate));
}

function lineNumber(index: number): number {
	return index + 2;
}

function summarizeEvidence(evidence: Evidence[], limit = 20): string {
	if (evidence.length === 0) {
		return "No issues found.";
	}

	return evidence
		.slice(0, limit)
		.map((item) => `${item.path}:${item.line} ${item.message}`)
		.join("\n");
}

function requireColumn(headers: string[], column: string | undefined, purpose: string): string {
	if (!column) {
		throw new Error(`Unable to determine ${purpose} column. Available columns: ${headers.join(", ")}`);
	}
	return column;
}

const parseCsvFinancials = defineTool({
	name: "parse_csv_financials",
	label: "Parse Finance CSV",
	description:
		"Parse a CSV finance file and summarize columns, row counts, numeric totals, and data-quality warnings.",
	promptSnippet: "Inspect a finance CSV and return source-grounded column and amount summaries.",
	promptGuidelines: [
		"Use parse_csv_financials before drawing conclusions from CSV finance files.",
		"Always cite file paths and line numbers from the tool output when reporting data-quality issues.",
	],
	parameters: Type.Object({
		path: Type.String({ description: "CSV file path to inspect" }),
		amountColumns: Type.Optional(Type.Array(Type.String(), { description: "Specific amount columns to total" })),
	}),
	async execute(_toolCallId, params) {
		const csv = await loadCsv(params.path);
		const selectedColumns = params.amountColumns?.length
			? params.amountColumns.filter((column) => csv.headers.includes(column))
			: csv.headers.filter((header) => csv.rows.some((row) => parseMoney(row[header] ?? "").valid));

		const totals = Object.fromEntries(
			selectedColumns.map((column) => [
				column,
				csv.rows.reduce((sum, row) => {
					const parsed = parseMoney(row[column] ?? "");
					return parsed.valid ? sum + parsed.value : sum;
				}, 0),
			]),
		);

		const evidence: Evidence[] = [];
		for (const [index, row] of csv.rows.entries()) {
			for (const column of selectedColumns) {
				const raw = row[column] ?? "";
				if (raw.trim() && !parseMoney(raw).valid) {
					evidence.push({
						path: params.path,
						line: lineNumber(index),
						message: `Invalid amount in "${column}": ${raw}`,
					});
				}
			}
		}

		return {
			content: [
				{
					type: "text",
					text: [
						`Parsed ${csv.rows.length} rows from ${params.path}.`,
						`Columns: ${csv.headers.join(", ")}`,
						`Totals: ${
							Object.entries(totals)
								.map(([column, total]) => `${column}=${formatMoney(total)}`)
								.join(", ") || "none"
						}`,
						summarizeEvidence(evidence),
					].join("\n"),
				},
			],
			details: {
				path: params.path,
				absolutePath: csv.absolutePath,
				headers: csv.headers,
				rowCount: csv.rows.length,
				totals,
				evidence,
			},
		};
	},
});

const validateLedger = defineTool({
	name: "validate_ledger",
	label: "Validate Ledger",
	description:
		"Validate ledger CSV rows for required columns, parseable dates, amount fields, and debit/credit balance.",
	promptSnippet: "Validate ledger structure and return evidence-backed accounting issues.",
	promptGuidelines: ["Use validate_ledger for ledger integrity checks before summarizing balances."],
	parameters: Type.Object({
		path: Type.String({ description: "Ledger CSV path" }),
		dateColumn: Type.Optional(Type.String({ description: "Date column name" })),
		amountColumn: Type.Optional(Type.String({ description: "Single signed amount column name" })),
		debitColumn: Type.Optional(Type.String({ description: "Debit column name" })),
		creditColumn: Type.Optional(Type.String({ description: "Credit column name" })),
		accountColumn: Type.Optional(Type.String({ description: "Account column name" })),
	}),
	async execute(_toolCallId, params) {
		const csv = await loadCsv(params.path);
		const dateColumn = getColumn(csv.headers, params.dateColumn, ["date", "transaction_date", "posting_date"]);
		const amountColumn = getColumn(csv.headers, params.amountColumn, ["amount", "net", "value"]);
		const debitColumn = getColumn(csv.headers, params.debitColumn, ["debit", "debits"]);
		const creditColumn = getColumn(csv.headers, params.creditColumn, ["credit", "credits"]);
		const accountColumn = getColumn(csv.headers, params.accountColumn, ["account", "account_code", "gl_account"]);
		const evidence: Evidence[] = [];

		if (!dateColumn) evidence.push({ path: params.path, line: 1, message: "Missing date column." });
		if (!amountColumn && (!debitColumn || !creditColumn)) {
			evidence.push({ path: params.path, line: 1, message: "Missing signed amount column or debit/credit pair." });
		}
		if (!accountColumn) evidence.push({ path: params.path, line: 1, message: "Missing account column." });

		let amountTotal = 0;
		let debitTotal = 0;
		let creditTotal = 0;

		for (const [index, row] of csv.rows.entries()) {
			if (dateColumn && row[dateColumn] && Number.isNaN(Date.parse(row[dateColumn]))) {
				evidence.push({ path: params.path, line: lineNumber(index), message: `Invalid date: ${row[dateColumn]}` });
			}

			if (amountColumn) {
				const parsed = parseMoney(row[amountColumn] ?? "");
				if (parsed.valid) amountTotal += parsed.value;
				else
					evidence.push({
						path: params.path,
						line: lineNumber(index),
						message: `Invalid amount: ${row[amountColumn] ?? ""}`,
					});
			}

			if (debitColumn) {
				const parsed = parseMoney(row[debitColumn] ?? "0");
				if (parsed.valid) debitTotal += parsed.value;
				else
					evidence.push({
						path: params.path,
						line: lineNumber(index),
						message: `Invalid debit: ${row[debitColumn] ?? ""}`,
					});
			}

			if (creditColumn) {
				const parsed = parseMoney(row[creditColumn] ?? "0");
				if (parsed.valid) creditTotal += parsed.value;
				else
					evidence.push({
						path: params.path,
						line: lineNumber(index),
						message: `Invalid credit: ${row[creditColumn] ?? ""}`,
					});
			}
		}

		if (debitColumn && creditColumn && Math.abs(debitTotal - creditTotal) > 0.005) {
			evidence.push({
				path: params.path,
				line: 1,
				message: `Ledger is out of balance: debit=${formatMoney(debitTotal)}, credit=${formatMoney(creditTotal)}.`,
			});
		}

		return {
			content: [
				{
					type: "text",
					text: [
						`Validated ${csv.rows.length} ledger rows from ${params.path}.`,
						`Columns used: date=${dateColumn ?? "n/a"}, amount=${amountColumn ?? "n/a"}, debit=${debitColumn ?? "n/a"}, credit=${creditColumn ?? "n/a"}, account=${accountColumn ?? "n/a"}`,
						`Totals: signed=${formatMoney(amountTotal)}, debit=${formatMoney(debitTotal)}, credit=${formatMoney(creditTotal)}`,
						summarizeEvidence(evidence),
					].join("\n"),
				},
			],
			details: {
				path: params.path,
				rowCount: csv.rows.length,
				columns: { dateColumn, amountColumn, debitColumn, creditColumn, accountColumn },
				totals: { amountTotal, debitTotal, creditTotal },
				evidence,
			},
		};
	},
});

const summarizeExpenses = defineTool({
	name: "summarize_expenses",
	label: "Summarize Expenses",
	description: "Summarize expense rows from a finance CSV by category, account, vendor, or another grouping column.",
	promptSnippet: "Group expense amounts and preserve source row evidence.",
	promptGuidelines: ["State which amount and grouping columns were used when summarizing expenses."],
	parameters: Type.Object({
		path: Type.String({ description: "CSV file path" }),
		amountColumn: Type.Optional(Type.String({ description: "Signed amount column name" })),
		groupByColumn: Type.Optional(
			Type.String({ description: "Grouping column such as category, account, or vendor" }),
		),
		expensesAreNegative: Type.Optional(
			Type.Boolean({ description: "Treat negative amounts as expenses; defaults to true" }),
		),
		limit: Type.Optional(Type.Number({ description: "Maximum groups to return" })),
	}),
	async execute(_toolCallId, params) {
		const csv = await loadCsv(params.path);
		const amountColumn = requireColumn(
			csv.headers,
			getColumn(csv.headers, params.amountColumn, ["amount", "net", "value"]),
			"amount",
		);
		const groupByColumn = requireColumn(
			csv.headers,
			getColumn(csv.headers, params.groupByColumn, ["category", "account", "vendor", "merchant", "description"]),
			"grouping",
		);
		const expensesAreNegative = params.expensesAreNegative ?? true;
		const grouped = new Map<string, { total: number; count: number; lines: number[] }>();

		for (const [index, row] of csv.rows.entries()) {
			const parsed = parseMoney(row[amountColumn] ?? "");
			if (!parsed.valid) continue;
			const isExpense = expensesAreNegative ? parsed.value < 0 : parsed.value > 0;
			if (!isExpense) continue;
			const key = row[groupByColumn] || "Uncategorized";
			const current = grouped.get(key) ?? { total: 0, count: 0, lines: [] };
			current.total += Math.abs(parsed.value);
			current.count++;
			if (current.lines.length < 5) current.lines.push(lineNumber(index));
			grouped.set(key, current);
		}

		const groups = Array.from(grouped.entries())
			.map(([group, values]) => ({ group, ...values }))
			.sort((a, b) => b.total - a.total)
			.slice(0, params.limit ?? 20);

		return {
			content: [
				{
					type: "text",
					text: [
						`Summarized expenses from ${params.path} using ${amountColumn} grouped by ${groupByColumn}.`,
						...groups.map(
							(group) =>
								`${group.group}: ${formatMoney(group.total)} across ${group.count} rows (evidence lines: ${group.lines.join(", ")})`,
						),
					].join("\n"),
				},
			],
			details: { path: params.path, amountColumn, groupByColumn, groups },
		};
	},
});

const reconcileTransactions = defineTool({
	name: "reconcile_transactions",
	label: "Reconcile Transactions",
	description: "Match transactions between two CSV files by amount and optional date tolerance.",
	promptSnippet: "Reconcile two transaction CSVs and report unmatched rows with path and line evidence.",
	promptGuidelines: ["Use reconcile_transactions when comparing bank, ledger, or payment exports."],
	parameters: Type.Object({
		leftPath: Type.String({ description: "First CSV path" }),
		rightPath: Type.String({ description: "Second CSV path" }),
		leftAmountColumn: Type.Optional(Type.String({ description: "Amount column in first CSV" })),
		rightAmountColumn: Type.Optional(Type.String({ description: "Amount column in second CSV" })),
		leftDateColumn: Type.Optional(Type.String({ description: "Date column in first CSV" })),
		rightDateColumn: Type.Optional(Type.String({ description: "Date column in second CSV" })),
		amountTolerance: Type.Optional(Type.Number({ description: "Allowed absolute amount difference" })),
		dateWindowDays: Type.Optional(Type.Number({ description: "Allowed date difference in days" })),
	}),
	async execute(_toolCallId, params) {
		const left = await loadCsv(params.leftPath);
		const right = await loadCsv(params.rightPath);
		const leftAmountColumn = requireColumn(
			left.headers,
			getColumn(left.headers, params.leftAmountColumn, ["amount", "net", "value"]),
			"left amount",
		);
		const rightAmountColumn = requireColumn(
			right.headers,
			getColumn(right.headers, params.rightAmountColumn, ["amount", "net", "value"]),
			"right amount",
		);
		const leftDateColumn = getColumn(left.headers, params.leftDateColumn, [
			"date",
			"transaction_date",
			"posting_date",
		]);
		const rightDateColumn = getColumn(right.headers, params.rightDateColumn, [
			"date",
			"transaction_date",
			"posting_date",
		]);
		const amountTolerance = params.amountTolerance ?? 0.01;
		const dateWindowMs = (params.dateWindowDays ?? 3) * 24 * 60 * 60 * 1000;
		const usedRight = new Set<number>();
		const matches: Array<{ leftLine: number; rightLine: number; amount: number }> = [];
		const unmatchedLeft: Evidence[] = [];

		for (const [leftIndex, leftRow] of left.rows.entries()) {
			const leftAmount = parseMoney(leftRow[leftAmountColumn] ?? "");
			if (!leftAmount.valid) {
				unmatchedLeft.push({ path: params.leftPath, line: lineNumber(leftIndex), message: "Invalid left amount." });
				continue;
			}

			const leftDate = leftDateColumn ? Date.parse(leftRow[leftDateColumn] ?? "") : undefined;
			const rightIndex = right.rows.findIndex((rightRow, candidateIndex) => {
				if (usedRight.has(candidateIndex)) return false;
				const rightAmount = parseMoney(rightRow[rightAmountColumn] ?? "");
				if (!rightAmount.valid || Math.abs(leftAmount.value - rightAmount.value) > amountTolerance) return false;
				if (!leftDateColumn || !rightDateColumn || Number.isNaN(leftDate)) return true;
				const rightDate = Date.parse(rightRow[rightDateColumn] ?? "");
				return !Number.isNaN(rightDate) && Math.abs((leftDate ?? 0) - rightDate) <= dateWindowMs;
			});

			if (rightIndex === -1) {
				unmatchedLeft.push({
					path: params.leftPath,
					line: lineNumber(leftIndex),
					message: `No matching transaction for amount ${leftAmount.raw}.`,
				});
			} else {
				usedRight.add(rightIndex);
				matches.push({
					leftLine: lineNumber(leftIndex),
					rightLine: lineNumber(rightIndex),
					amount: leftAmount.value,
				});
			}
		}

		const unmatchedRight = right.rows
			.map((row, index) => ({ row, index }))
			.filter(({ index }) => !usedRight.has(index))
			.map(({ index }) => ({
				path: params.rightPath,
				line: lineNumber(index),
				message: "No matching transaction in left file.",
			}));

		return {
			content: [
				{
					type: "text",
					text: [
						`Reconciled ${params.leftPath} against ${params.rightPath}.`,
						`Matched ${matches.length} rows; unmatched left=${unmatchedLeft.length}; unmatched right=${unmatchedRight.length}.`,
						summarizeEvidence([...unmatchedLeft, ...unmatchedRight]),
					].join("\n"),
				},
			],
			details: {
				matches,
				unmatchedLeft,
				unmatchedRight,
				columns: { leftAmountColumn, rightAmountColumn, leftDateColumn, rightDateColumn },
				amountTolerance,
				dateWindowDays: params.dateWindowDays ?? 3,
			},
		};
	},
});

const detectAnomalies = defineTool({
	name: "detect_anomalies",
	label: "Detect Finance Anomalies",
	description: "Detect duplicate, invalid, missing, and threshold-based anomalies in finance CSV rows.",
	promptSnippet: "Find suspicious finance rows and return evidence paths and line numbers.",
	promptGuidelines: [
		"Do not call anomalies fraud; report them as items requiring review unless evidence proves otherwise.",
	],
	parameters: Type.Object({
		path: Type.String({ description: "CSV file path" }),
		amountColumn: Type.Optional(Type.String({ description: "Amount column name" })),
		dateColumn: Type.Optional(Type.String({ description: "Date column name" })),
		keyColumns: Type.Optional(Type.Array(Type.String(), { description: "Columns used to detect duplicates" })),
		largeAmountThreshold: Type.Optional(Type.Number({ description: "Absolute amount threshold to flag" })),
	}),
	async execute(_toolCallId, params) {
		const csv = await loadCsv(params.path);
		const amountColumn = getColumn(csv.headers, params.amountColumn, ["amount", "net", "value"]);
		const dateColumn = getColumn(csv.headers, params.dateColumn, ["date", "transaction_date", "posting_date"]);
		const keyColumns =
			params.keyColumns?.filter((column) => csv.headers.includes(column)) ??
			[dateColumn, amountColumn, getColumn(csv.headers, undefined, ["description", "vendor", "merchant"])].filter(
				(column): column is string => Boolean(column),
			);
		const seen = new Map<string, number>();
		const evidence: Evidence[] = [];

		for (const [index, row] of csv.rows.entries()) {
			if (dateColumn && row[dateColumn] && Number.isNaN(Date.parse(row[dateColumn]))) {
				evidence.push({ path: params.path, line: lineNumber(index), message: `Invalid date: ${row[dateColumn]}` });
			}
			if (amountColumn) {
				const parsed = parseMoney(row[amountColumn] ?? "");
				if (!parsed.valid) {
					evidence.push({
						path: params.path,
						line: lineNumber(index),
						message: `Invalid amount: ${row[amountColumn] ?? ""}`,
					});
				} else if (params.largeAmountThreshold && Math.abs(parsed.value) >= params.largeAmountThreshold) {
					evidence.push({
						path: params.path,
						line: lineNumber(index),
						message: `Amount exceeds threshold: ${parsed.raw}`,
					});
				}
			}

			const key = keyColumns.map((column) => row[column] ?? "").join("|");
			if (key.trim()) {
				const firstLine = seen.get(key);
				if (firstLine) {
					evidence.push({
						path: params.path,
						line: lineNumber(index),
						message: `Possible duplicate of line ${firstLine}.`,
					});
				} else {
					seen.set(key, lineNumber(index));
				}
			}
		}

		return {
			content: [
				{
					type: "text",
					text: [`Detected ${evidence.length} review items in ${params.path}.`, summarizeEvidence(evidence)].join(
						"\n",
					),
				},
			],
			details: { path: params.path, amountColumn, dateColumn, keyColumns, evidence },
		};
	},
});

const generateFinanceReport = defineTool({
	name: "generate_finance_report",
	label: "Generate Finance Report",
	description: "Create a structured finance report from supplied findings, sources, and limitations.",
	promptSnippet: "Generate a structured finance report with assumptions, sources, findings, and review items.",
	promptGuidelines: [
		"Use generate_finance_report only after gathering source evidence.",
		"Include limitations and avoid investment, legal, audit, or tax advice.",
	],
	parameters: Type.Object({
		title: Type.String({ description: "Report title" }),
		period: Type.Optional(Type.String({ description: "Reporting period" })),
		sources: Type.Array(Type.String(), { description: "Source file paths or references used" }),
		findings: Type.Array(Type.String(), { description: "Evidence-backed findings" }),
		limitations: Type.Optional(Type.Array(Type.String(), { description: "Known limitations or assumptions" })),
		reviewItems: Type.Optional(Type.Array(Type.String(), { description: "Items requiring human review" })),
	}),
	async execute(_toolCallId, params) {
		const report = {
			title: params.title,
			period: params.period ?? "Not specified",
			sources: params.sources,
			findings: params.findings,
			limitations: params.limitations ?? [
				"This report is analytical assistance and is not audit, accounting, tax, legal, or investment advice.",
			],
			reviewItems: params.reviewItems ?? [],
		};

		return {
			content: [
				{
					type: "text",
					text: [
						`# ${report.title}`,
						`Period: ${report.period}`,
						"",
						"## Sources",
						...report.sources.map((source) => `- ${source}`),
						"",
						"## Findings",
						...report.findings.map((finding) => `- ${finding}`),
						"",
						"## Limitations",
						...report.limitations.map((limitation) => `- ${limitation}`),
						"",
						"## Review items",
						...(report.reviewItems.length ? report.reviewItems.map((item) => `- ${item}`) : ["- None provided."]),
					].join("\n"),
				},
			],
			details: report,
		};
	},
	renderResult(result, _options, _theme) {
		const text = result.content[0];
		return new Text(text?.type === "text" ? text.text : "", 0, 0);
	},
});

const exportStructuredFinanceResult = defineTool({
	name: "export_structured_finance_result",
	label: "Export Finance Result",
	description: "Return a final structured finance result and terminate the agent turn.",
	promptSnippet: "Emit the final finance answer in a structured, source-aware format.",
	promptGuidelines: [
		"Use export_structured_finance_result as the final action when the user asks for structured finance output.",
		"Include source paths and line numbers for exceptions and reconciliation issues.",
	],
	parameters: Type.Object({
		summary: Type.String({ description: "Short plain-language summary" }),
		sources: Type.Array(Type.String(), { description: "Source files or references used" }),
		totals: Type.Optional(Type.Record(Type.String(), Type.Number(), { description: "Named financial totals" })),
		exceptions: Type.Optional(Type.Array(Type.String(), { description: "Evidence-backed exceptions or anomalies" })),
		nextSteps: Type.Optional(Type.Array(Type.String(), { description: "Recommended review steps" })),
		disclaimer: Type.Optional(Type.String({ description: "Finance boundary disclaimer" })),
	}),
	async execute(_toolCallId, params) {
		return {
			content: [
				{ type: "text", text: `Exported structured finance result for ${params.sources.length} source(s).` },
			],
			details: {
				...params,
				disclaimer:
					params.disclaimer ??
					"Analytical assistance only; not a substitute for a registered accountant, auditor, tax professional, legal advisor, or investment advisor.",
			},
			terminate: true,
		};
	},
});

function financeSystemPrompt(): string {
	return `

## Finance Agent Extension

You are operating with finance-agent guidance. Act as a conservative finance file analysis, report preparation, and ledger reconciliation assistant.

Boundaries:
- Do not provide investment advice, legal advice, audit opinions, or tax filings.
- Do not present outputs as a substitute for a registered accountant, auditor, tax professional, legal advisor, or investment advisor.
- For calculations, state the source file, relevant columns, assumptions, and evidence line numbers for exceptions.
- Before modifying finance records, summarize the intended impact and ask for confirmation when UI confirmation is available.
- Treat reconciliation differences, duplicates, invalid amounts, and missing records as review items with evidence paths and line numbers.
- Avoid exposing full sensitive account numbers, credentials, tokens, or private identifiers in final answers; mask where possible.
- Prefer read-only analysis. Write generated reports separately from source ledgers or raw transaction backups.
`;
}

export default function financeAgent(pi: ExtensionAPI) {
	pi.on("resources_discover", () => ({
		promptPaths: FINANCE_CONTEXT_FILES.map((file) => join(financeResourceDir, file)),
	}));

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}${financeSystemPrompt()}`,
	}));

	pi.on("tool_call", async (event, ctx) => {
		if ((event.toolName === "write" || event.toolName === "edit") && typeof event.input.path === "string") {
			const path = event.input.path;
			if (isSensitivePath(path)) {
				return { block: true, reason: `finance-agent blocks writes to protected path: ${path}` };
			}

			if (/\.(csv|tsv|xlsx?|ledger|journal)$/i.test(path) && ctx.hasUI) {
				const ok = await ctx.ui.confirm(
					"Confirm finance file change",
					`You are about to modify a finance-related file:\n${path}\n\nProceed only after summarizing the expected impact.`,
				);
				if (!ok) return { block: true, reason: "User declined finance file modification." };
			}
		}

		if (event.toolName === "bash" && typeof event.input.command === "string") {
			const command = event.input.command;
			const blocked = DANGEROUS_COMMAND_PATTERNS.find((pattern) => pattern.test(command));
			if (blocked) {
				return { block: true, reason: `finance-agent blocks risky command matching ${blocked}` };
			}
		}

		return undefined;
	});

	pi.registerTool(parseCsvFinancials);
	pi.registerTool(validateLedger);
	pi.registerTool(summarizeExpenses);
	pi.registerTool(reconcileTransactions);
	pi.registerTool(generateFinanceReport);
	pi.registerTool(detectAnomalies);
	pi.registerTool(exportStructuredFinanceResult);
}
