# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-01-16

### Added

- Initial release
- AI-powered domain name generation using Anthropic, OpenAI, or OpenRouter
- Domain availability checking via RDAP with WHOIS fallback
- Optional Namecheap integration for pricing information
- `search` command to generate and check domain availability
- `check` command to check specific domains
- `pricing` command to get TLD pricing from Namecheap
- Filtering by TLD, price, availability, word count, and character length
- Sorting by price, name, or length
- JSON output mode for programmatic use
- Rate limiting and retry with backoff
- Input validation to prevent injection attacks
