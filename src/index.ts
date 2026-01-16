export {
	checkDomains as checkDomainsNamecheap,
	getTldPricing,
} from "./namecheap.js";
export { checkDomains, checkDomainsRdap } from "./rdap.js";
export { generateDomainIdeas, combineWithTlds } from "./generate.js";
export { searchDomains } from "./search.js";
export type {
	DomainCheckResult,
	DomainIdea,
	DomainSearchResult,
	GenerateOptions,
	GenerationResult,
	NamecheapConfig,
	SearchOptions,
	TldPricing,
} from "./types.js";
