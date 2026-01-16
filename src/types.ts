export interface DomainCheckResult {
	domain: string;
	available: boolean;
	isPremium: boolean;
	premiumPrice?: number;
	registerPrice?: number;
	error?: string;
}

export interface TldPricing {
	tld: string;
	registerPrice: number;
	renewPrice: number;
	currency: string;
}

export interface NamecheapConfig {
	apiUser: string;
	apiKey: string;
	username?: string;
	clientIp?: string;
	sandbox?: boolean;
}

export interface GenerateOptions {
	count?: number;
	maxWords?: number;
	allowHyphens?: boolean;
	allowAbbreviations?: boolean;
	creativity?: number;
}

export interface DomainIdea {
	name: string;
	wordCount: number;
}

export interface GenerationResult {
	ideas: DomainIdea[];
	reasoning: string;
}

export interface SearchOptions extends GenerateOptions {
	tlds: string[];
	availableOnly?: boolean;
	excludePremium?: boolean;
	maxPrice?: number;
	maxLength?: number;
	sortBy?: "price" | "name" | "length";
}

export interface DomainSearchResult extends DomainCheckResult {
	wordCount: number;
	baseName: string;
	tld: string;
}
