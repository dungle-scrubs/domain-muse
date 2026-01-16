/**
 * Result of checking a domain's availability.
 */
export interface DomainCheckResult {
	/** Fully qualified domain name (e.g., "example.com") */
	domain: string;
	/** Whether the domain is available for registration */
	available: boolean;
	/** Whether the domain is a premium domain with special pricing */
	isPremium: boolean;
	/** Price for premium domains (only set if isPremium is true) */
	premiumPrice?: number;
	/** Standard registration price from pricing API */
	registerPrice?: number;
	/** Error message if the check failed */
	error?: string;
}

/**
 * Pricing information for a top-level domain.
 */
export interface TldPricing {
	/** TLD without leading dot (e.g., "com", "io") */
	tld: string;
	/** Price to register a new domain */
	registerPrice: number;
	/** Price to renew an existing domain */
	renewPrice: number;
	/** Currency code (e.g., "USD") */
	currency: string;
}

/**
 * Configuration for Namecheap API authentication.
 */
export interface NamecheapConfig {
	/** API user (usually same as username) */
	apiUser: string;
	/** API key from Namecheap dashboard */
	apiKey: string;
	/** Account username (defaults to apiUser if not provided) */
	username?: string;
	/** Whitelisted client IP address (auto-detected if not provided) */
	clientIp?: string;
	/** Use sandbox API instead of production */
	sandbox?: boolean;
}

/**
 * Options for domain name generation.
 */
export interface GenerateOptions {
	/** Number of domain ideas to generate (default: 30) */
	count?: number;
	/** Maximum words per domain name (default: 3) */
	maxWords?: number;
	/** Allow hyphens in domain names (default: true) */
	allowHyphens?: boolean;
	/** Allow abbreviations like "mgmt", "dev" (default: true) */
	allowAbbreviations?: boolean;
	/** LLM temperature 0-1 (default: 0.9) */
	creativity?: number;
}

/**
 * A generated domain name idea.
 */
export interface DomainIdea {
	/** Base domain name without TLD (e.g., "habitflow") */
	name: string;
	/** Number of semantic words in the name */
	wordCount: number;
}

/**
 * Result from domain name generation.
 */
export interface GenerationResult {
	/** Generated domain name ideas */
	ideas: DomainIdea[];
	/** LLM reasoning about the generation process */
	reasoning: string;
}

/**
 * Options for searching and filtering domain names.
 */
export interface SearchOptions extends GenerateOptions {
	/** TLDs to check (e.g., ["com", "io", "co"]) */
	tlds: string[];
	/** Only return available domains */
	availableOnly?: boolean;
	/** Exclude premium-priced domains */
	excludePremium?: boolean;
	/** Maximum registration price filter */
	maxPrice?: number;
	/** Maximum domain name length in characters */
	maxLength?: number;
	/** Sort order for results */
	sortBy?: "price" | "name" | "length";
}

/**
 * Extended domain check result with search metadata.
 */
export interface DomainSearchResult extends DomainCheckResult {
	/** Number of semantic words in the domain name */
	wordCount: number;
	/** Base domain name without TLD */
	baseName: string;
	/** TLD without leading dot */
	tld: string;
}
