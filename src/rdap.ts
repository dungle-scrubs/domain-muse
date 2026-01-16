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

function isValidDomain(domain: string): boolean {
	if (!domain || domain.length > 253) return false;
	return DOMAIN_REGEX.test(domain);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function checkSingleDomain(domain: string): Promise<DomainCheckResult> {
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

	// Try RDAP first if available
	if (rdapServer) {
		const result = await checkViaRdap(domain, rdapServer);
		if (!result.error) {
			return result;
		}
		// RDAP failed, fall through to WHOIS
	}

	// Fall back to WHOIS
	const whoisServer = WHOIS_SERVERS[tld];
	if (whoisServer || !rdapServer) {
		return checkViaWhois(domain);
	}

	return {
		domain,
		available: false,
		isPremium: false,
		error: `No lookup method for .${tld}`,
	};
}

export async function checkDomains(
	domains: string[],
): Promise<DomainCheckResult[]> {
	// Separate domains by lookup method for different concurrency limits
	const rdapDomains: string[] = [];
	const whoisDomains: string[] = [];
	const servers = await getBootstrapServers();

	for (const domain of domains) {
		const tld = domain.split(".").pop()?.toLowerCase();
		if (tld && servers[tld]) {
			rdapDomains.push(domain);
		} else {
			whoisDomains.push(domain);
		}
	}

	const rdapLimit = pLimit(RDAP_CONCURRENCY);
	const whoisLimit = pLimit(WHOIS_CONCURRENCY);

	const rdapPromises = rdapDomains.map((domain) =>
		rdapLimit(() => checkSingleDomain(domain)),
	);
	const whoisPromises = whoisDomains.map((domain) =>
		whoisLimit(() => checkSingleDomain(domain)),
	);

	const results = await Promise.all([...rdapPromises, ...whoisPromises]);

	// Reorder results to match input order
	const resultMap = new Map(results.map((r) => [r.domain, r]));
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

// Keep old name as alias for backwards compatibility
export const checkDomainsRdap = checkDomains;
