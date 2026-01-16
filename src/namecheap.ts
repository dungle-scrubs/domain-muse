import type {
	DomainCheckResult,
	NamecheapConfig,
	TldPricing,
} from "./types.js";

const SANDBOX_URL = "https://api.sandbox.namecheap.com/xml.response";
const PRODUCTION_URL = "https://api.namecheap.com/xml.response";

async function detectClientIp(): Promise<string> {
	const response = await fetch("https://api.ipify.org", {
		signal: AbortSignal.timeout(5000),
	});
	return (await response.text()).trim();
}

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

function checkApiError(xml: string): string | null {
	if (xml.includes('Status="ERROR"')) {
		const errorMatch = xml.match(/<Error[^>]*>([^<]*)<\/Error>/);
		return errorMatch?.[1] ?? "Unknown API error";
	}
	return null;
}

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

export async function getTldPricing(
	config: NamecheapConfig,
	tlds?: string[],
): Promise<TldPricing[]> {
	const clientIp = config.clientIp ?? (await detectClientIp());
	if (!clientIp) {
		throw new Error("Could not determine client IP for Namecheap API");
	}

	const requestedTlds = tlds?.map((t) => t.toLowerCase().replace(/^\./, ""));

	const url = buildApiUrl(config, "namecheap.users.getPricing", {
		ProductType: "DOMAIN",
		ProductCategory: "REGISTER",
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

	const results: TldPricing[] = [];
	const productRegex = /<Product\s+Name="([^"]*)"[^>]*>([\s\S]*?)<\/Product>/g;

	for (const productMatch of xml.matchAll(productRegex)) {
		const tld = (productMatch[1] ?? "").toLowerCase();
		if (requestedTlds && !requestedTlds.includes(tld)) {
			continue;
		}

		const productContent = productMatch[2] ?? "";
		const priceMatch = productContent.match(
			/<Price\s+Duration="1"[^>]*Price="([^"]*)"[^>]*Currency="([^"]*)"/,
		);

		if (priceMatch) {
			const registerPrice = Number.parseFloat(priceMatch[1] ?? "0");
			const currency = priceMatch[2] ?? "USD";
			results.push({
				tld,
				registerPrice,
				renewPrice: registerPrice,
				currency,
			});
		}
	}

	return results.sort((a, b) => a.registerPrice - b.registerPrice);
}
