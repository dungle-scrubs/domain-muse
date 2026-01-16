import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pLimit from "p-limit";
import type { DomainCheckResult } from "./types.js";

const execFileAsync = promisify(execFile);

// Domain validation regex - basic but catches injection attempts
const DOMAIN_REGEX =
	/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

// Concurrency limits
const RDAP_CONCURRENCY = 10;
const WHOIS_CONCURRENCY = 3; // WHOIS servers are more sensitive to rate limiting

// Retry configuration
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// Reliable RDAP servers - verified to work
const RDAP_SERVERS: Record<string, string> = {
	com: "https://rdap.verisign.com/com/v1",
	net: "https://rdap.verisign.com/net/v1",
	org: "https://rdap.publicinterestregistry.org/rdap",
	info: "https://rdap.identitydigital.services/rdap",
	ai: "https://rdap.identitydigital.services/rdap",
	bio: "https://rdap.identitydigital.services/rdap",
	live: "https://rdap.identitydigital.services/rdap",
	software: "https://rdap.identitydigital.services/rdap",
	studio: "https://rdap.identitydigital.services/rdap",
};

// WHOIS servers for TLDs without reliable RDAP
const WHOIS_SERVERS: Record<string, string> = {
	io: "whois.nic.io",
	co: "whois.nic.co",
	me: "whois.nic.me",
	tv: "whois.nic.tv",
	cc: "whois.nic.cc",
	app: "whois.nic.google",
};

// Patterns indicating domain is available (expanded)
const WHOIS_AVAILABLE_PATTERNS = [
	// Common "not found" patterns
	/^no match/im,
	/^not found/im,
	/^no data found/im,
	/^no entries found/im,
	/^nothing found/im,
	/domain not found/i,
	/no match for/i,
	/not registered/i,
	/no such domain/i,
	/object not found/i,
	/query didn't return any result/i,
	// Status-based patterns
	/status:\s*available/i,
	/status:\s*free/i,
	/domain status:\s*no object found/i,
	// Registrar-specific patterns
	/the queried object does not exist/i,
	/no information available/i,
	/domain you requested is not known/i,
	/this domain is available/i,
	/is available for registration/i,
];

const IANA_BOOTSTRAP = "https://data.iana.org/rdap/dns.json";

let bootstrapCache: Record<string, string> | null = null;

/**
 * Validates domain name format to prevent injection attacks.
 * @param domain - Domain name to validate
 * @returns True if domain format is valid
 */
function isValidDomain(domain: string): boolean {
	if (!domain || domain.length > 253) return false;
	return DOMAIN_REGEX.test(domain);
}

/**
 * Delays execution for the specified duration.
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries an async function with exponential backoff.
 * @param fn - Function to retry
 * @param retries - Maximum number of retries (default: MAX_RETRIES)
 * @returns Result of the function
 * @throws Last error if all retries fail
 */
async function withRetry<T>(
	fn: () => Promise<T>,
	retries = MAX_RETRIES,
): Promise<T> {
	let lastError: Error | undefined;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await fn();
		} catch (e) {
			lastError = e instanceof Error ? e : new Error(String(e));
			if (attempt < retries) {
				await sleep(RETRY_DELAY_MS * (attempt + 1));
			}
		}
	}
	throw lastError;
}

/**
 * Fetches RDAP bootstrap servers from IANA, with fallback to hardcoded list.
 * Results are cached for subsequent calls.
 * @returns Map of TLD to RDAP server URL
 */
async function getBootstrapServers(): Promise<Record<string, string>> {
	if (bootstrapCache) return bootstrapCache;

	try {
		const response = await fetch(IANA_BOOTSTRAP, {
			signal: AbortSignal.timeout(5000),
		});

		if (!response.ok) return RDAP_SERVERS;

		const data = (await response.json()) as {
			services: Array<[string[], string[]]>;
		};

		const servers: Record<string, string> = { ...RDAP_SERVERS };
		for (const [tlds, urls] of data.services) {
			const url = urls[0];
			if (url) {
				for (const tld of tlds) {
					servers[tld.toLowerCase()] = url.replace(/\/$/, "");
				}
			}
		}

		bootstrapCache = servers;
		return servers;
	} catch {
		return RDAP_SERVERS;
	}
}

/**
 * Checks domain availability via WHOIS protocol.
 * @param domain - Domain name to check
 * @returns Domain check result with availability status
 */
async function checkViaWhois(domain: string): Promise<DomainCheckResult> {
	const parts = domain.split(".");
	const tld = parts[parts.length - 1]?.toLowerCase();

	if (!tld) {
		return {
			domain,
			available: false,
			isPremium: false,
			error: "Invalid domain",
		};
	}

	const whoisServer = WHOIS_SERVERS[tld];

	try {
		// Use execFile with args array to prevent command injection
		const args = whoisServer ? ["-h", whoisServer, domain] : [domain];

		const { stdout } = await withRetry(() =>
			execFileAsync("whois", args, { timeout: 15000 }),
		);

		const isAvailable = WHOIS_AVAILABLE_PATTERNS.some((pattern) =>
			pattern.test(stdout),
		);

		return { domain, available: isAvailable, isPremium: false };
	} catch (e) {
		const error = e instanceof Error ? e.message : "WHOIS lookup failed";
		return { domain, available: false, isPremium: false, error };
	}
}

/**
 * Checks domain availability via RDAP protocol.
 * @param domain - Domain name to check
 * @param rdapServer - RDAP server URL for the domain's TLD
 * @returns Domain check result with availability status
 */
async function checkViaRdap(
	domain: string,
	rdapServer: string,
): Promise<DomainCheckResult> {
	try {
		const result = await withRetry(async () => {
			const url = `${rdapServer}/domain/${domain}`;
			const response = await fetch(url, {
				signal: AbortSignal.timeout(10000),
				headers: { Accept: "application/rdap+json" },
			});

			if (response.status === 404) {
				return { domain, available: true, isPremium: false };
			}

			if (response.status === 200) {
				return { domain, available: false, isPremium: false };
			}

			throw new Error(`RDAP returned ${response.status}`);
		});
		return result;
	} catch (e) {
		const error = e instanceof Error ? e.message : "Unknown error";
		return { domain, available: false, isPremium: false, error };
	}
}

/**
 * Extended domain check result that tracks WHOIS fallback need.
 */
interface RdapCheckResult extends DomainCheckResult {
	/** True if RDAP failed and WHOIS fallback is needed */
	needsWhoisFallback?: boolean;
}

/**
 * Attempts RDAP lookup, marking domains that need WHOIS fallback.
 * @param domain - Domain name to check
 * @returns Check result with fallback flag if RDAP unavailable/failed
 */
async function checkViaRdapOnly(domain: string): Promise<RdapCheckResult> {
	// Validate domain format
	if (!isValidDomain(domain)) {
		return {
			domain,
			available: false,
			isPremium: false,
			error: "Invalid domain format",
		};
	}

	const parts = domain.split(".");
	const tld = parts[parts.length - 1]?.toLowerCase();

	if (!tld) {
		return {
			domain,
			available: false,
			isPremium: false,
			error: "Invalid domain",
		};
	}

	const servers = await getBootstrapServers();
	const rdapServer = servers[tld];

	if (!rdapServer) {
		// No RDAP server, needs WHOIS
		return {
			domain,
			available: false,
			isPremium: false,
			needsWhoisFallback: true,
		};
	}

	const result = await checkViaRdap(domain, rdapServer);
	if (result.error) {
		// RDAP failed, mark for WHOIS fallback
		return { ...result, needsWhoisFallback: true };
	}
	return result;
}

/**
 * Checks availability of multiple domains using RDAP with WHOIS fallback.
 * Uses two-pass approach: RDAP first (10 concurrent), then WHOIS for failures (3 concurrent).
 * @param domains - Array of domain names to check
 * @returns Array of check results in same order as input
 */
export async function checkDomains(
	domains: string[],
): Promise<DomainCheckResult[]> {
	// Separate domains by lookup method for different concurrency limits
	const rdapDomains: string[] = [];
	const whoisOnlyDomains: string[] = [];
	const servers = await getBootstrapServers();

	for (const domain of domains) {
		const tld = domain.split(".").pop()?.toLowerCase();
		if (tld && servers[tld]) {
			rdapDomains.push(domain);
		} else {
			whoisOnlyDomains.push(domain);
		}
	}

	const rdapLimit = pLimit(RDAP_CONCURRENCY);
	const whoisLimit = pLimit(WHOIS_CONCURRENCY);

	// First pass: try RDAP for domains with RDAP servers
	const rdapResults = await Promise.all(
		rdapDomains.map((domain) => rdapLimit(() => checkViaRdapOnly(domain))),
	);

	// Collect domains that need WHOIS fallback (RDAP failed or no RDAP server)
	const needsWhoisFallback: string[] = [];
	const successfulRdapResults: DomainCheckResult[] = [];

	for (const result of rdapResults) {
		if (result.needsWhoisFallback) {
			needsWhoisFallback.push(result.domain);
		} else {
			successfulRdapResults.push(result);
		}
	}

	// Second pass: WHOIS for domains without RDAP and failed RDAP domains
	// All WHOIS requests go through whoisLimit for proper rate limiting
	const allWhoisDomains = [...whoisOnlyDomains, ...needsWhoisFallback];
	const whoisResults = await Promise.all(
		allWhoisDomains.map((domain) => whoisLimit(() => checkViaWhois(domain))),
	);

	// Combine results
	const allResults = [...successfulRdapResults, ...whoisResults];

	// Reorder results to match input order
	const resultMap = new Map(allResults.map((r) => [r.domain, r]));
	return domains.map(
		(d) =>
			resultMap.get(d) ?? {
				domain: d,
				available: false,
				isPremium: false,
				error: "Result missing",
			},
	);
}

/**
 * Alias for checkDomains (backwards compatibility).
 * @deprecated Use checkDomains instead
 */
export const checkDomainsRdap = checkDomains;
