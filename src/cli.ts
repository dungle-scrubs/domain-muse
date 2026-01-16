#!/usr/bin/env node
import chalk from "chalk";
import Table from "cli-table3";
import { program } from "commander";
import ora from "ora";
import { getTldPricing } from "./namecheap.js";
import { checkDomains } from "./rdap.js";
import { searchDomains } from "./search.js";
import type {
	DomainCheckResult,
	DomainSearchResult,
	NamecheapConfig,
} from "./types.js";

function getNamecheapConfig(): NamecheapConfig | undefined {
	const apiUser = process.env.NAMECHEAP_API_USER;
	const apiKey = process.env.NAMECHEAP_API_KEY;

	if (!apiUser || !apiKey) {
		return undefined;
	}

	return {
		apiUser,
		apiKey,
		username: process.env.NAMECHEAP_USERNAME,
		clientIp: process.env.NAMECHEAP_CLIENT_IP,
		sandbox: process.env.NAMECHEAP_SANDBOX?.toLowerCase() === "true",
	};
}

function requireNamecheapConfig(): NamecheapConfig {
	const config = getNamecheapConfig();
	if (!config) {
		console.error(
			chalk.red(
				"Error: NAMECHEAP_API_USER and NAMECHEAP_API_KEY environment variables required for pricing",
			),
		);
		process.exit(1);
	}
	return config;
}

function formatPrice(price: number | undefined): string {
	if (price === undefined) return chalk.dim("-");
	return chalk.green(`$${price.toFixed(2)}`);
}

function formatAvailability(
	domain: DomainSearchResult | DomainCheckResult,
): string {
	if (domain.error) return chalk.red("error");
	if (!domain.available) return chalk.dim("taken");
	if (domain.isPremium) return chalk.yellow("premium");
	return chalk.green("available");
}

function printSearchTable(domains: DomainSearchResult[]): void {
	const table = new Table({
		head: [
			chalk.bold("Domain"),
			chalk.bold("Status"),
			chalk.bold("Price"),
			chalk.bold("Words"),
		],
		style: { head: [], border: [] },
		chars: {
			top: "─",
			"top-mid": "┬",
			"top-left": "┌",
			"top-right": "┐",
			bottom: "─",
			"bottom-mid": "┴",
			"bottom-left": "└",
			"bottom-right": "┘",
			left: "│",
			"left-mid": "├",
			mid: "─",
			"mid-mid": "┼",
			right: "│",
			"right-mid": "┤",
			middle: "│",
		},
	});

	for (const d of domains) {
		const price = d.isPremium ? d.premiumPrice : d.registerPrice;
		table.push([
			d.available ? chalk.white(d.domain) : chalk.dim(d.domain),
			formatAvailability(d),
			formatPrice(price),
			chalk.dim(d.wordCount.toString()),
		]);
	}

	console.log(table.toString());
}

function printSummary(domains: DomainSearchResult[]): void {
	const available = domains.filter((d) => d.available && !d.error);
	const premium = available.filter((d) => d.isPremium);
	const regular = available.filter((d) => !d.isPremium);
	const errors = domains.filter((d) => d.error);

	console.log();
	console.log(
		chalk.bold("Summary:"),
		chalk.green(`${available.length} available`),
		chalk.dim(`(${regular.length} regular, ${premium.length} premium)`),
		errors.length > 0 ? chalk.red(`${errors.length} errors`) : "",
	);

	if (errors.length > 0) {
		const uniqueErrors = [...new Set(errors.map((e) => e.error))];
		if (uniqueErrors.length === 1) {
			console.log(chalk.red(`Error: ${uniqueErrors[0]}`));
		} else {
			for (const err of uniqueErrors.slice(0, 3)) {
				console.log(chalk.red(`  - ${err}`));
			}
		}
	}
}

program
	.name("domain-muse")
	.description("AI-powered domain name generator and availability checker")
	.version("0.1.0");

program
	.command("search")
	.description("Generate domain ideas from a concept and check availability")
	.argument("<concept>", "The concept or idea to generate domain names for")
	.option("-t, --tlds <tlds>", "Comma-separated TLDs to check", "com,io,co")
	.option("-c, --count <n>", "Number of domain ideas to generate", "30")
	.option("-w, --max-words <n>", "Maximum words per domain name", "3")
	.option("--hyphens", "Allow hyphens in domain names", true)
	.option("--no-hyphens", "Disallow hyphens in domain names")
	.option("--abbreviations", "Allow abbreviations", true)
	.option("--no-abbreviations", "Disallow abbreviations")
	.option(
		"--creativity <n>",
		"Creativity level 0-1 (higher = more creative)",
		"0.9",
	)
	.option("--available-only", "Only show available domains", false)
	.option("--no-premium", "Exclude premium domains")
	.option("--max-price <n>", "Maximum price filter")
	.option("--max-length <n>", "Maximum domain name length (characters)")
	.option("--sort <by>", "Sort results: price, name, or length", "price")
	.option("--json", "Output as JSON", false)
	.option("--reasoning", "Show LLM reasoning", true)
	.option("--no-reasoning", "Hide LLM reasoning")
	.action(async (concept: string, options) => {
		const namecheapConfig = getNamecheapConfig();
		const isJson = options.json;

		const spinner = isJson
			? null
			: ora({
					text: "Generating domain ideas...",
					color: "cyan",
				}).start();

		try {
			const result = await searchDomains(
				concept,
				{
					tlds: options.tlds.split(",").map((t: string) => t.trim()),
					count: Number.parseInt(options.count, 10),
					maxWords: Number.parseInt(options.maxWords, 10),
					allowHyphens: options.hyphens,
					allowAbbreviations: options.abbreviations,
					creativity: Number.parseFloat(options.creativity),
					availableOnly: options.availableOnly,
					excludePremium: !options.premium,
					maxPrice: options.maxPrice
						? Number.parseFloat(options.maxPrice)
						: undefined,
					maxLength: options.maxLength
						? Number.parseInt(options.maxLength, 10)
						: undefined,
					sortBy: options.sort as "price" | "name" | "length",
				},
				namecheapConfig,
			);

			if (isJson) {
				console.log(
					JSON.stringify(
						{
							concept,
							reasoning: result.reasoning,
							domains: result.domains,
						},
						null,
						2,
					),
				);
			} else {
				spinner?.succeed(
					`Generated ${result.domains.length} domain suggestions`,
				);
				console.log();
				if (options.reasoning) {
					console.log(chalk.dim(result.reasoning));
					console.log();
				}
				printSearchTable(result.domains);
				printSummary(result.domains);

				if (!namecheapConfig) {
					console.log();
					console.log(
						chalk.dim(
							"Tip: Set NAMECHEAP_API_USER and NAMECHEAP_API_KEY for pricing info",
						),
					);
				}
			}
		} catch (error) {
			if (isJson) {
				console.error(
					JSON.stringify({
						error: error instanceof Error ? error.message : "Unknown error",
					}),
				);
			} else {
				spinner?.fail(
					chalk.red(error instanceof Error ? error.message : "Unknown error"),
				);
			}
			process.exit(1);
		}
	});

program
	.command("check")
	.description("Check availability of specific domain names")
	.argument("<domains...>", "Domain names to check (e.g., example.com)")
	.option("--available-only", "Only show available domains")
	.option("--json", "Output as JSON", false)
	.action(async (domains: string[], options) => {
		const isJson = options.json;

		const spinner = isJson
			? null
			: ora({
					text: `Checking ${domains.length} domains...`,
					color: "cyan",
				}).start();

		try {
			let results = await checkDomains(domains);

			if (options.availableOnly) {
				results = results.filter((r) => r.available);
			}

			if (isJson) {
				console.log(JSON.stringify(results, null, 2));
			} else {
				spinner?.succeed(`Checked ${domains.length} domains`);
				console.log();

				const table = new Table({
					head: [chalk.bold("Domain"), chalk.bold("Status")],
					style: { head: [], border: [] },
				});

				for (const r of results) {
					let status: string;
					if (r.error) {
						status = chalk.red(`error: ${r.error}`);
					} else if (!r.available) {
						status = chalk.dim("taken");
					} else if (r.isPremium) {
						status = chalk.yellow(
							`premium ${r.premiumPrice ? `$${r.premiumPrice}` : ""}`,
						);
					} else {
						status = chalk.green("available");
					}
					table.push([
						r.available ? chalk.white(r.domain) : chalk.dim(r.domain),
						status,
					]);
				}

				console.log(table.toString());
			}
		} catch (error) {
			if (isJson) {
				console.error(
					JSON.stringify({
						error: error instanceof Error ? error.message : "Unknown error",
					}),
				);
			} else {
				spinner?.fail(
					chalk.red(error instanceof Error ? error.message : "Unknown error"),
				);
			}
			process.exit(1);
		}
	});

program
	.command("pricing")
	.description("Get TLD pricing information (requires Namecheap credentials)")
	.argument("[tlds...]", "Specific TLDs to check (e.g., com io dev)")
	.option("--json", "Output as JSON", false)
	.action(async (tlds: string[], options) => {
		const config = requireNamecheapConfig();
		const isJson = options.json;

		const spinner = isJson
			? null
			: ora({
					text: "Fetching TLD pricing...",
					color: "cyan",
				}).start();

		try {
			const results = await getTldPricing(
				config,
				tlds.length > 0 ? tlds : undefined,
			);

			if (isJson) {
				console.log(JSON.stringify(results, null, 2));
			} else {
				spinner?.succeed(`Found pricing for ${results.length} TLDs`);
				console.log();

				const table = new Table({
					head: [
						chalk.bold("TLD"),
						chalk.bold("Register"),
						chalk.bold("Renew"),
					],
					style: { head: [], border: [] },
				});

				for (const p of results) {
					table.push([
						chalk.white(`.${p.tld}`),
						chalk.green(`$${p.registerPrice.toFixed(2)}`),
						chalk.dim(`$${p.renewPrice.toFixed(2)}`),
					]);
				}

				console.log(table.toString());
			}
		} catch (error) {
			if (isJson) {
				console.error(
					JSON.stringify({
						error: error instanceof Error ? error.message : "Unknown error",
					}),
				);
			} else {
				spinner?.fail(
					chalk.red(error instanceof Error ? error.message : "Unknown error"),
				);
			}
			process.exit(1);
		}
	});

program.parse();
