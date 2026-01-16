import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Gets the configured language model based on environment variables.
 * Checks providers in order: Anthropic, OpenAI, OpenRouter.
 * @returns Configured language model instance
 * @throws Error if no API key is configured
 */
export function getModel(): LanguageModel {
	if (process.env.ANTHROPIC_API_KEY) {
		const anthropic = createAnthropic({
			apiKey: process.env.ANTHROPIC_API_KEY,
		});
		return anthropic("claude-sonnet-4-20250514");
	}

	if (process.env.OPENAI_API_KEY) {
		const openai = createOpenAI({
			apiKey: process.env.OPENAI_API_KEY,
		});
		return openai("gpt-4o");
	}

	if (process.env.OPENROUTER_API_KEY) {
		const openrouter = createOpenAI({
			apiKey: process.env.OPENROUTER_API_KEY,
			baseURL: "https://openrouter.ai/api/v1",
		});
		return openrouter("anthropic/claude-sonnet-4");
	}

	throw new Error(
		"No AI provider configured. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY",
	);
}
