const axios = require('axios');
require('dotenv').config();

const LLM_LINK = process.env.LLM_LINK;
const LLM_MODEL_NAME = process.env.LLM_MODEL_NAME;

/**
 * Send a prompt to the Ollama LLM and return the response.
 */
async function askLLM(prompt, options = {}) {
    try {
        const startTime = Date.now();
        const response = await axios.post(LLM_LINK, {
            model: LLM_MODEL_NAME,
            prompt: prompt,
            stream: false,
            options: {
                temperature: options.temperature !== undefined ? options.temperature : 0.1,
                num_predict: options.maxTokens || 500
            }
        }, {
            timeout: 300000,
            headers: { 'Content-Type': 'application/json' }
        });

        const elapsed = Date.now() - startTime;

        return {
            success: true,
            answer: response.data.response || '',
            llmTime: elapsed,
            evalCount: response.data.eval_count || 0
        };
    } catch (error) {
        console.error(`  ✗ LLM error: ${error.message}`);
        return {
            success: false,
            answer: '',
            llmTime: 0,
            error: error.message
        };
    }
}

/**
 * Build a prompt for the LLM to answer a factual question using web search context.
 */
function buildAnswerPrompt(question, context) {
    return `You are a factual question-answering assistant. Answer the question using ONLY the provided context.

Rules:
- Give ONLY the direct answer (a name, number, date, place, etc.)
- Do NOT explain, do NOT add sentences, do NOT say "based on the text"
- Do NOT say "I don't know" or "not mentioned" — always extract the best answer from the context
- If the context contains the answer in any form, extract it
- Keep your answer as SHORT as possible (ideally under 10 words)

Context:
${context}

Question: ${question}

Answer:`;
}

/**
 * Build a prompt for the LLM to judge whether an answer matches the expected answer.
 */
function buildJudgePrompt(question, expectedAnswer, llmAnswer) {
    return `You are an answer evaluator. Determine if the given answer matches the expected answer.

RULES — mark as CORRECT if:
- The answers mean the same thing in any format ("Jan-08" = "January 2008")
- The given answer contains the expected answer with extra detail ("tramp steamer" when expected is "tramp")
- Names match even with titles ("Dr. John Smith" = "John Smith")
- Numbers match in any format ("1,20,000" = "120000" = "€120,000")
- The core answer is correct even if extra clarification is added

Mark as INCORRECT only if the core answer is genuinely wrong or different.

Question: ${question}
Expected Answer: ${expectedAnswer}
Given Answer: ${llmAnswer}

Respond with ONLY one word:
- CORRECT
- INCORRECT

Verdict:`;
}

module.exports = { askLLM, buildAnswerPrompt, buildJudgePrompt };
