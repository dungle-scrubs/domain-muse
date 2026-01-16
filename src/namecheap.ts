import type {
	DomainCheckResult,
	NamecheapConfig,
	TldPricing,
} from "./types.js";

const SANDBOX_URL = "https://api.sandbox.namecheap.com/xml.response";
const PRODUCTION_URL = "https://api.namecheap.com/xml.response";

/**
 * Detects the client's public IP address via ipify.org.
 * @returns Public IP address string
 * @throws Error if IP detection fails
 */
async function detectClientIp(): Promise<string> {
	const response = await fetch("https://api.ipify.org", {
		signal: AbortSignal.timeout(5000),
	});
	if (!response.ok) {
		throw new Error(`Failed to detect client IP: HTTP ${response.status}`);
	}
	return (await response.text()).trim();
}

/**
 * Builds a Namecheap API URL with authentication and parameters.
 * @param config - Namecheap API configuration
 * @param command - API command name (e.g., "namecheap.domains.check")
 * @param params - Additional query parameters
 * @returns Full API URL with query string
 */
function buildApiUrl(
	config: NamecheapConfig,
	command: string,
	params: Record<string, string>,
): string {
	const baseUrl = config.sandbox ? SANDBOX_URL : PRODUCTION_URL;
	const allParams = {
		ApiUser: config.apiUser,
		ApiKey: config.apiKey,
		UserName: config.username ?? config.apiUser,
		Command: command,
		...params,
	};

	const query = Object.entries(allParams)
		.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
		.join("&");

	return `${baseUrl}?${query}`;
}

/**
 * Checks Namecheap API XML response for error status.
 * @param xml - Raw XML response from Namecheap API
 * @returns Error message if present, null otherwise
 */
function checkApiError(xml: string): string | null {
	if (xml.includes('Status="ERROR"')) {
		const errorMatch = xml.match(/<Error[^>]*>([^<]*)<\/Error>/);
		return errorMatch?.[1] ?? "Unknown API error";
	}
	return null;
}

/**
 * Parses domain check results from Namecheap API XML response.
 * Extracts attributes order-independently to handle varying XML formats.
 * @param xml - Raw XML response from domains.check API
 * @returns Array of domain check results
 */
function parseDomainCheckResults(xml: string): DomainCheckResult[] {
	const results: DomainCheckResult[] = [];
	const domainRegex = /<DomainCheckResult\s+([^>]*)\/>/g;

	for (const match of xml.matchAll(domainRegex)) {
		const attrs = match[1] ?? "";
		const domain = attrs.match(/Domain="([^"]*)"/)?.[1] ?? "";
		const available =
			attrs.match(/Available="([^"]*)"/)?.[1]?.toLowerCase() === "true";
		const isPremium =
			attrs.match(/IsPremiumName="([^"]*)"/)?.[1]?.toLowerCase() === "true";
		const premiumPriceStr = attrs.match(
			/PremiumRegistrationPrice="([^"]*)"/,
		)?.[1];
		const premiumPrice = premiumPriceStr
			? Number.parseFloat(premiumPriceStr)
			: undefined;

		if (domain) {
			results.push({ domain, available, isPremium, premiumPrice });
		}
	}

	return results;
}

/**
 * Checks domain availability via Namecheap API.
 * Processes domains in batches of 50 (API limit).
 * @param config - Namecheap API configuration
 * @param domains - Array of domain names to check
 * @returns Array of check results with availability and premium status
 */
export async function checkDomains(
	config: NamecheapConfig,
	domains: string[],
): Promise<DomainCheckResult[]> {
	const clientIp = config.clientIp ?? (await detectClientIp());
	if (!clientIp) {
		throw new Error("Could not determine client IP for Namecheap API");
	}

	const results: DomainCheckResult[] = [];
	const batchSize = 50;

	for (let i = 0; i < domains.length; i += batchSize) {
		const batch = domains.slice(i, i + batchSize);
		const domainList = batch.join(",");

		try {
			const url = buildApiUrl(config, "namecheap.domains.check", {
				DomainList: domainList,
				ClientIp: clientIp,
			});

			const response = await fetch(url, {
				headers: { "User-Agent": "domain-muse/1.0" },
				signal: AbortSignal.timeout(30000),
			});

			if (!response.ok) {
				const error = await response.text();
				for (const domain of batch) {
					results.push({
						domain,
						available: false,
						isPremium: false,
						error: `HTTP ${response.status}: ${error}`,
					});
				}
				continue;
			}

			const xml = await response.text();
			const apiError = checkApiError(xml);

			if (apiError) {
				for (const domain of batch) {
					results.push({
						domain,
						available: false,
						isPremium: false,
						error: apiError,
					});
				}
				continue;
			}

			results.push(...parseDomainCheckResults(xml));
		} catch (e) {
			const error = e instanceof Error ? e.message : "Unknown error";
			for (const domain of batch) {
				results.push({ domain, available: false, isPremium: false, error });
			}
		}
	}

	return results;
}

/**
 * Parses TLD pricing from Namecheap API XML response.
 * Extracts 1-year prices with order-independent attribute parsing.
 * @param xml - Raw XML response from getPricing API
 * @param tlds - Optional TLD filter (returns all if not specified)
 * @returns Map of TLD to price and currency
 */
function parsePriceFromXml(
	xml: string,
	tlds?: string[],
): Map<string, { price: number; currency: string }> {
	const results = new Map<string, { price: number; currency: string }>();
	const requestedTlds = tlds?.map((t) => t.toLowerCase().replace(/^\./, ""));
	const productRegex = /<Product\s+Name="([^"]*)"[^>]*>([\s\S]*?)<\/Product>/g;

	for (const productMatch of xml.matchAll(productRegex)) {
		const tld = (productMatch[1] ?? "").toLowerCase();
		if (requestedTlds && !requestedTlds.includes(tld)) {
			continue;
		}

		const productContent = productMatch[2] ?? "";
		// Find Price element with Duration="1" - extract attributes separately to avoid order dependency
		const priceElementRegex = /<Price\s+([^>]*)\/>/g;
		for (const priceMatch of productContent.matchAll(priceElementRegex)) {
			const attrs = priceMatch[1] ?? "";
			const duration = attrs.match(/Duration="([^"]*)"/)?.[1];
			if (duration !== "1") continue;

			const priceValue = attrs.match(/Price="([^"]*)"/)?.[1];
			const currency = attrs.match(/Currency="([^"]*)"/)?.[1] ?? "USD";

			if (priceValue) {
				results.set(tld, {
					price: Number.parseFloat(priceValue),
					currency,
				});
				break; // Found the 1-year price for this TLD
			}
		}
	}

	return results;
}

/**
 * Fetches pricing for a specific category (REGISTER or RENEW).
 * @param config - Namecheap API configuration
 * @param clientIp - Client IP address for API authentication
 * @param category - Pricing category to fetch
 * @param tlds - Optional TLD filter
 * @returns Map of TLD to price and currency
 */
async function fetchPricingCategory(
	config: NamecheapConfig,
	clientIp: string,
	category: "REGISTER" | "RENEW",
	tlds?: string[],
): Promise<Map<string, { price: number; currency: string }>> {
	const url = buildApiUrl(config, "namecheap.users.getPricing", {
		ProductType: "DOMAIN",
		ProductCategory: category,
		ClientIp: clientIp,
	});

	const response = await fetch(url, {
		headers: { "User-Agent": "domain-muse/1.0" },
		signal: AbortSignal.timeout(30000),
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}

	const xml = await response.text();
	const apiError = checkApiError(xml);
	if (apiError) {
		throw new Error(apiError);
	}

	return parsePriceFromXml(xml, tlds);
}

/**
 * Gets TLD pricing information from Namecheap API.
 * Fetches both registration and renewal prices in parallel.
 * @param config - Namecheap API configuration
 * @param tlds - Optional TLD filter (returns all available if not specified)
 * @returns Array of TLD pricing sorted by registration price
 */
export async function getTldPricing(
	config: NamecheapConfig,
	tlds?: string[],
): Promise<TldPricing[]> {
	const clientIp = config.clientIp ?? (await detectClientIp());
	if (!clientIp) {
		throw new Error("Could not determine client IP for Namecheap API");
	}

	// Fetch both register and renew pricing in parallel
	const [registerPricing, renewPricing] = await Promise.all([
		fetchPricingCategory(config, clientIp, "REGISTER", tlds),
		fetchPricingCategory(config, clientIp, "RENEW", tlds),
	]);

	const results: TldPricing[] = [];
	for (const [tld, { price: registerPrice, currency }] of registerPricing) {
		const renewData = renewPricing.get(tld);
		results.push({
			tld,
			registerPrice,
			renewPrice: renewData?.price ?? registerPrice,
			currency,
		});
	}

	return results.sort((a, b) => a.registerPrice - b.registerPrice);
}
