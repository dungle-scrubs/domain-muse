import { combineWithTlds, generateDomainIdeas } from "./generate.js";
import { getTldPricing } from "./namecheap.js";
import { checkDomains } from "./rdap.js";
import type {
	DomainSearchResult,
	NamecheapConfig,
	SearchOptions,
	TldPricing,
} from "./types.js";

/**
 * Result from a domain search operation.
 */
export interface SearchResult {
	/** Matched domains with availability and pricing */
	domains: DomainSearchResult[];
	/** LLM reasoning about the generation process */
	reasoning: string;
	/** TLD pricing map for reference */
	pricing: Map<string, TldPricing>;
}

/**
 * Generates domain name ideas and checks availability.
 * Combines LLM generation, RDAP/WHOIS availability checks, and optional Namecheap pricing.
 * @param concept - The concept or idea to generate domain names for
 * @param options - Search and filter options
 * @param namecheapConfig - Optional Namecheap config for pricing data
 * @returns Search results with domains, reasoning, and pricing
 */
export async function searchDomains(
	concept: string,
	options: SearchOptions,
	namecheapConfig?: NamecheapConfig,
): Promise<SearchResult> {
	const { ideas, reasoning } = await generateDomainIdeas(concept, {
		count: options.count,
		maxWords: options.maxWords,
		allowHyphens: options.allowHyphens,
		allowAbbreviations: options.allowAbbreviations,
		creativity: options.creativity,
	});

	const candidates = combineWithTlds(ideas, options.tlds);
	const domainNames = candidates.map((c) => c.domain);

	const checkResults = await checkDomains(domainNames);

	const pricingMap = new Map<string, TldPricing>();
	if (namecheapConfig) {
		try {
			const pricingResults = await getTldPricing(namecheapConfig, options.tlds);
			for (const p of pricingResults) {
				pricingMap.set(p.tld, p);
			}
		} catch {
			// Pricing is optional, continue without it
		}
	}

	const checkMap = new Map(checkResults.map((r) => [r.domain, r]));

	let domains: DomainSearchResult[] = candidates.map((candidate) => {
		const check = checkMap.get(candidate.domain);
		const pricing = pricingMap.get(candidate.tld);

		return {
			domain: candidate.domain,
			baseName: candidate.baseName,
			tld: candidate.tld,
			wordCount: candidate.wordCount,
			available: check?.available ?? false,
			isPremium: check?.isPremium ?? false,
			premiumPrice: check?.premiumPrice,
			registerPrice: pricing?.registerPrice,
			error: check?.error,
		};
	});

	if (options.availableOnly) {
		domains = domains.filter((d) => d.available);
	}

	if (options.excludePremium) {
		domains = domains.filter((d) => !d.isPremium);
	}

	if (options.maxPrice !== undefined) {
		const maxPrice = options.maxPrice;
		domains = domains.filter((d) => {
			const price = d.isPremium ? d.premiumPrice : d.registerPrice;
			// Include domains with unknown pricing (don't exclude based on missing data)
			return price === undefined || price <= maxPrice;
		});
	}

	if (options.maxLength !== undefined) {
		const maxLength = options.maxLength;
		domains = domains.filter((d) => d.baseName.length <= maxLength);
	}

	if (options.sortBy === "price") {
		domains.sort((a, b) => {
			const priceA = a.isPremium ? a.premiumPrice : a.registerPrice;
			const priceB = b.isPremium ? b.premiumPrice : b.registerPrice;
			return (
				(priceA ?? Number.POSITIVE_INFINITY) -
				(priceB ?? Number.POSITIVE_INFINITY)
			);
		});
	} else if (options.sortBy === "name") {
		domains.sort((a, b) => a.domain.localeCompare(b.domain));
	} else if (options.sortBy === "length") {
		domains.sort((a, b) => a.baseName.length - b.baseName.length);
	}

	return { domains, reasoning, pricing: pricingMap };
}
