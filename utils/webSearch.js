const axios = require('axios');
require('dotenv').config();

const KEIRO_API_KEY = process.env.KEIRO_API;
const KEIRO_ENDPOINT = 'https://kierolabs.space/api/research-pro';

// Max context chars to send to LLM (llama3.2 3B works best with ~6000 chars)
const MAX_CONTEXT_CHARS = 6000;

/**
 * Call the Keiro research-pro API and return structured results.
 */
async function searchWeb(query, topN = 5) {
    try {
        const startTime = Date.now();
        const response = await axios.post(KEIRO_ENDPOINT, {
            apiKey: KEIRO_API_KEY,
            query: query
        }, {
            timeout: 120000,
            headers: { 'Content-Type': 'application/json' }
        });

        const elapsed = Date.now() - startTime;
        const data = response.data?.data || response.data || {};

        return {
            success: data.success || false,
            searchResults: data.search_results || [],
            extractedContent: data.extracted_content || [],
            summaryText: data.summary_text || '',
            searchTime: elapsed
        };
    } catch (error) {
        if (error.response) {
            console.error(`  ✗ Web search error: ${error.response.status} - ${JSON.stringify(error.response.data || '').substring(0, 300)}`);
        } else {
            console.error(`  ✗ Web search error: ${error.message}`);
        }
        return {
            success: false,
            searchResults: [],
            extractedContent: [],
            summaryText: '',
            searchTime: 0,
            error: error.message
        };
    }
}

/**
 * Clean raw content text — collapse whitespace, remove junk.
 */
function cleanContent(content) {
    if (!content) return '';
    return content
        .replace(/\r\n/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/ {2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Build a context string from Keiro search results.
 * Prioritizes search snippets first, then extracted content capped at MAX_CONTEXT_CHARS.
 */
function buildContextFromSearch(searchResult) {
    const { extractedContent, searchResults } = searchResult;
    const contextParts = [];
    let totalChars = 0;

    // Step 1: Always include search snippets first (concise, relevant)
    if (searchResults && searchResults.length > 0) {
        for (const result of searchResults) {
            const snippet = result.snippet || '';
            const title = result.title || 'Unknown';
            if (snippet && totalChars < MAX_CONTEXT_CHARS) {
                const part = `[Source: ${title}]\n${snippet}`;
                contextParts.push(part);
                totalChars += part.length;
                console.log(`    📄 [SNIPPET] ${title.substring(0, 50)} → ${snippet.length} chars`);
            }
        }
    }

    // Step 2: Add extracted content (trimmed to fit within budget)
    if (extractedContent && extractedContent.length > 0) {
        for (const item of extractedContent) {
            if (totalChars >= MAX_CONTEXT_CHARS) break;

            // Skip failed extractions
            if (!item.success && item.success !== undefined) {
                console.log(`    📄 [SKIP] ${(item.title || 'Unknown').substring(0, 50)} → extraction failed`);
                continue;
            }

            const rawContent = item.content || '';
            const title = item.search_title || item.title || 'Unknown';

            if (!rawContent || rawContent.length === 0) {
                console.log(`    📄 [SKIP] ${title.substring(0, 50)} → no content`);
                continue;
            }

            const cleaned = cleanContent(rawContent);
            if (cleaned.length === 0) continue;

            // Trim to remaining budget
            const remaining = MAX_CONTEXT_CHARS - totalChars;
            if (remaining <= 200) break;

            const trimmed = cleaned.substring(0, remaining);
            const part = `[Full Content: ${title}]\n${trimmed}`;
            contextParts.push(part);
            totalChars += part.length;
            console.log(`    📄 [FULL] ${title.substring(0, 50)} → ${Math.min(cleaned.length, remaining)} of ${cleaned.length} chars`);
        }
    }

    console.log(`    📊 Total context: ${totalChars} chars (limit: ${MAX_CONTEXT_CHARS})`);
    return contextParts.join('\n\n---\n\n');
}

/**
 * Get ALL raw content for saving to file (no size limit).
 */
function getFullContentForSaving(searchResult) {
    const { extractedContent, searchResults } = searchResult;
    const parts = [];

    // Search snippets
    if (searchResults && searchResults.length > 0) {
        parts.push('=== SEARCH SNIPPETS ===\n');
        for (const r of searchResults) {
            parts.push(`[${r.title || 'Unknown'}]\n${r.snippet || 'No snippet'}\nURL: ${r.url || 'N/A'}\n`);
        }
    }

    // Full extracted content
    if (extractedContent && extractedContent.length > 0) {
        parts.push('\n=== FULL EXTRACTED CONTENT ===\n');
        for (const item of extractedContent) {
            const title = item.search_title || item.title || 'Unknown';
            const content = item.content || 'No content';
            const url = item.url || 'N/A';
            parts.push(`\n--- [${title}] ---\nURL: ${url}\n${content}\n`);
        }
    }

    return parts.join('\n');
}

module.exports = { searchWeb, buildContextFromSearch, getFullContentForSaving };
