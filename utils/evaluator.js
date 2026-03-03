const { askLLM, buildJudgePrompt } = require('./llm');

// Phrases that indicate the LLM didn't actually answer
const NON_ANSWER_PHRASES = [
    'not mentioned', 'not specified', 'not stated', 'not provided',
    'not found', 'not available', 'no information', 'no answer',
    'i don\'t know', 'i cannot', 'i can\'t', 'unable to',
    'does not mention', 'doesn\'t mention', 'not clear',
    'cannot determine', 'not enough information'
];

const MONTH_MAP = {
    jan: 'january', feb: 'february', mar: 'march', apr: 'april',
    may: 'may', jun: 'june', jul: 'july', aug: 'august',
    sep: 'september', oct: 'october', nov: 'november', dec: 'december'
};

/**
 * Deep normalize a string for comparison.
 */
function deepNormalize(s) {
    if (!s) return '';
    let n = s.toLowerCase().trim();

    // Remove common punctuation
    n = n.replace(/[.,!?;:'"()\-/\\]/g, ' ');

    // Expand month abbreviations
    for (const [abbr, full] of Object.entries(MONTH_MAP)) {
        const regex = new RegExp(`\\b${abbr}\\.?\\b`, 'g');
        n = n.replace(regex, full);
    }

    // Normalize 2-digit years
    n = n.replace(/\b(\d{1,2})\b(?!\d)/g, (match) => {
        const num = parseInt(match);
        if (num >= 0 && num <= 30 && match.length <= 2) return `20${match.padStart(2, '0')}`;
        if (num > 30 && num <= 99 && match.length <= 2) return `19${match}`;
        return match;
    });

    // Remove commas from numbers
    n = n.replace(/(\d),(\d)/g, '$1$2');

    // Remove currency symbols
    n = n.replace(/[€$£¥₹]/g, '');

    // Collapse whitespace
    n = n.replace(/\s+/g, ' ').trim();

    return n;
}

/**
 * Check if the LLM answer is a non-answer (e.g., "not mentioned", "I don't know").
 */
function isNonAnswer(answer) {
    const lower = answer.toLowerCase();
    return NON_ANSWER_PHRASES.some(phrase => lower.includes(phrase));
}

/**
 * Smart string match — handles format differences, containment, word overlap.
 */
function smartMatch(expected, actual) {
    if (!expected || !actual) return false;

    const normExpected = deepNormalize(expected);
    const normActual = deepNormalize(actual);

    // Exact match
    if (normActual === normExpected) return true;

    // Containment match (either direction)
    if (normActual.includes(normExpected)) return true;
    if (normExpected.includes(normActual) && normActual.length > 3) return true;

    // Word overlap: check if 80%+ of significant expected words appear in actual
    const expectedWords = normExpected.split(/\s+/).filter(w => w.length > 2);
    if (expectedWords.length > 0) {
        const matchCount = expectedWords.filter(w => normActual.includes(w)).length;
        if (matchCount / expectedWords.length >= 0.8) return true;
    }

    return false;
}

/**
 * Hybrid evaluation: smart string match first, then LLM judge for hard cases.
 * This avoids the unreliable 3B model making random mistakes on obvious matches.
 */
async function llmJudge(question, expectedAnswer, llmAnswer) {
    const startTime = Date.now();

    // Step 1: Reject non-answers immediately
    if (isNonAnswer(llmAnswer)) {
        return {
            verdict: 'INCORRECT',
            time: Date.now() - startTime,
            method: 'non-answer-filter'
        };
    }

    // Step 2: Smart string match — catches obvious matches reliably
    if (smartMatch(expectedAnswer, llmAnswer)) {
        return {
            verdict: 'CORRECT',
            time: Date.now() - startTime,
            method: 'smart-match'
        };
    }

    // Step 3: LLM judge for cases where string match can't determine
    try {
        const prompt = buildJudgePrompt(question, expectedAnswer, llmAnswer);
        const result = await askLLM(prompt);
        const elapsed = Date.now() - startTime;

        if (result.success) {
            const raw = result.answer.trim().toUpperCase();
            let verdict = 'INCORRECT';
            if (raw.includes('CORRECT') && !raw.includes('INCORRECT')) {
                verdict = 'CORRECT';
            }
            return { verdict, time: elapsed, method: 'llm-judge' };
        }

        return { verdict: 'INCORRECT', time: elapsed, method: 'llm-error' };
    } catch (err) {
        return {
            verdict: 'INCORRECT',
            time: Date.now() - startTime,
            method: 'error'
        };
    }
}

module.exports = { llmJudge, smartMatch };
