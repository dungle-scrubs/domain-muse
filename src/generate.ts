import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "./provider.js";
import type { DomainIdea, GenerateOptions, GenerationResult } from "./types.js";

const DomainIdeaSchema = z.object({
	name: z.string(),
	wordCount: z.number(),
});

const GenerationResultSchema = z.object({
	names: z.array(DomainIdeaSchema),
	reasoning: z.string(),
});

function buildPrompt(concept: string, options: GenerateOptions): string {
	const count = options.count ?? 30;
	const maxWords = options.maxWords ?? 3;
	const allowHyphens = options.allowHyphens ?? true;
	const allowAbbreviations = options.allowAbbreviations ?? true;

	const hyphenInstructions = allowHyphens
		? `- Include BOTH hyphenated versions (e.g., "habit-flow", "track-daily") AND non-hyphenated versions (e.g., "habitflow", "trackdaily")
- Hyphens can make multi-word domains more readable`
		: "- Do NOT use hyphens";

	const abbreviationInstructions = allowAbbreviations
		? `- Use common abbreviations (mgmt, dev, app, biz, etc.)
- Consider acronyms and initialisms`
		: "- Do NOT use abbreviations - use full words only";

	return `You are a creative brand naming expert. Generate ${count} unique, highly varied domain name ideas for:

"${concept}"

CRITICAL REQUIREMENTS:
1. Generate a DIVERSE mix - don't just use the same words repeatedly
2. Word count: Generate names with 1 to ${maxWords} words
3. EXPAND THE CONCEPT: Use synonyms, related words, metaphors, and adjacent concepts

VOCABULARY EXPANSION (apply to every concept):
- Synonyms and near-synonyms of key words
- Metaphors and analogies
- Related verbs and action words
- Emotional associations
- Visual/sensory associations
- Domain-specific jargon
- Short, punchy alternatives

4. Include ALL of these styles (at least 3-4 of each):

SINGLE WORDS (1 word):
- Invented/coined words (like "Spotify", "Hulu", "Trello")
- Real words with new meaning (like "Slack", "Notion", "Linear")
${allowAbbreviations ? "- Abbreviations or acronyms" : ""}
- Word mashups/portmanteaus

TWO WORDS:
- Descriptive pairs (like "DropBox", "MailChimp")
- Abstract + concrete (like "BlueHost", "DreamHost")
- Action + noun (like "JumpCloud", "SendGrid")
${allowHyphens ? '- Hyphenated versions (like "habit-track", "daily-flow")' : ""}

${
	maxWords >= 3
		? `THREE WORDS:
- Short phrases (like "getpocket", "read-it-later")
${allowHyphens ? '- Hyphenated phrases (like "track-my-habits")' : ""}`
		: ""
}

OTHER VARIATIONS:
- With common prefixes: get, try, use, go, my, hey, hi
- With common suffixes: ly, ify, hub, lab, io, app, hq, base, kit
- Playful misspellings (like "lyft", "fiverr")
- Unexpected word combinations

${hyphenInstructions}

${abbreviationInstructions}

DO NOT include TLDs (.com, .io) - just the base domain names.
Generate EXACTLY ${count} unique names.

IMPORTANT: For each name, count the SEMANTIC words:
- "plantparenting" = 2 words
- "habittracker101" = 3 words
- "myapp" = 2 words
- "spotify" = 1 word
- "track-daily" = 2 words`;
}

export async function generateDomainIdeas(
	concept: string,
	options: GenerateOptions = {},
): Promise<GenerationResult> {
	const model = getModel();
	const prompt = buildPrompt(concept, options);
	const temperature = options.creativity ?? 0.9;

	const { object } = await generateObject({
		model,
		schema: GenerationResultSchema,
		prompt,
		temperature,
	});

	const allowHyphens = options.allowHyphens ?? true;
	const cleanPattern = allowHyphens ? /[^a-z0-9-]/g : /[^a-z0-9]/g;
	const seen = new Set<string>();

	const ideas: DomainIdea[] = object.names
		.map((item) => {
			const cleanName = item.name
				.toLowerCase()
				.replace(cleanPattern, "")
				.replace(/^-+|-+$/g, "")
				.replace(/-{2,}/g, "-");

			return { name: cleanName, wordCount: item.wordCount };
		})
		.filter((item) => {
			if (item.name.length < 3 || item.name.length > 20) return false;
			if (seen.has(item.name)) return false;
			seen.add(item.name);
			return true;
		});

	return { ideas, reasoning: object.reasoning };
}

export function combineWithTlds(
	ideas: DomainIdea[],
	tlds: string[],
): Array<{ domain: string; baseName: string; tld: string; wordCount: number }> {
	const domains: Array<{
		domain: string;
		baseName: string;
		tld: string;
		wordCount: number;
	}> = [];

	for (const idea of ideas) {
		for (const tld of tlds) {
			const cleanTld = tld.toLowerCase().replace(/^\./, "");
			domains.push({
				domain: `${idea.name}.${cleanTld}`,
				baseName: idea.name,
				tld: cleanTld,
				wordCount: idea.wordCount,
			});
		}
	}

	return domains;
}
