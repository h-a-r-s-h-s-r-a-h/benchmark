const path = require('path');
const fs = require('fs');
const { parseCSV, initResultsCSV, appendResultCSV } = require('../utils/csvHelper');
const { searchWeb, buildContextFromSearch, getFullContentForSaving } = require('../utils/webSearch');
const { askLLM, buildAnswerPrompt } = require('../utils/llm');
const { llmJudge } = require('../utils/evaluator');

const RESULTS_HEADERS = [
    'index',
    'topic',
    'answer_type',
    'question',
    'expected_answer',
    'llm_answer',
    'llm_judge_verdict',
    'running_accuracy',
    'context_sent_to_llm_chars',
    'content_file',
    'search_snippets',
    'search_time_ms',
    'llm_answer_time_ms',
    'llm_judge_time_ms',
    'total_time_ms',
    'search_success',
    'llm_success',
    'error'
];

/**
 * Helper to write to both console and log file.
 */
function createLogger(logPath) {
    const stream = fs.createWriteStream(logPath, { flags: 'w' });
    return {
        log: (msg = '') => {
            console.log(msg);
            stream.write(msg + '\n');
        },
        close: () => stream.end()
    };
}

/**
 * Run the full benchmark pipeline.
 */
async function runBenchmark(options = {}) {
    const {
        csvPath = path.join(__dirname, '..', 'simpleqa_full_dataset.csv'),
        outputPath = path.join(__dirname, '..', `benchmark_results_${Date.now()}.csv`),
        limit = 0,
        startFrom = 0,
        topN = 2
    } = options;

    // Create a folder for full web content files
    const contentDir = path.join(path.dirname(outputPath), 'web_content');
    if (!fs.existsSync(contentDir)) {
        fs.mkdirSync(contentDir, { recursive: true });
    }

    // Create clean log file
    const logPath = outputPath.replace('.csv', '_log.txt');
    const log = createLogger(logPath);

    log.log('');
    log.log('╔══════════════════════════════════════════╗');
    log.log('║      SimpleQA Benchmark Runner           ║');
    log.log('╚══════════════════════════════════════════╝');
    log.log(`  Input CSV   : ${csvPath}`);
    log.log(`  Output CSV  : ${outputPath}`);
    log.log(`  Log File    : ${logPath}`);
    log.log(`  Content Dir : ${contentDir}`);
    log.log(`  Limit       : ${limit || 'ALL'}`);
    log.log(`  Start From  : ${startFrom}`);
    log.log(`  Search Top N: ${topN}`);
    log.log('');

    // ── Read dataset ──
    log.log('📂 Reading dataset...');
    const dataset = parseCSV(csvPath);
    log.log(`   Total questions in dataset: ${dataset.length}`);

    const end = limit > 0 ? Math.min(startFrom + limit, dataset.length) : dataset.length;
    const questionsToProcess = dataset.slice(startFrom, end);
    log.log(`   Processing questions ${startFrom + 1} to ${end}`);
    log.log('');

    // ── Initialize output CSV ──
    initResultsCSV(outputPath, RESULTS_HEADERS);

    // ── Stats tracker ──
    const stats = {
        total: questionsToProcess.length,
        processed: 0,
        correct: 0,
        incorrect: 0,
        partial: 0,
        unknown: 0,
        errors: 0,
        totalSearchTime: 0,
        totalLLMTime: 0,
        totalJudgeTime: 0
    };

    // ── Process each question ──
    for (let i = 0; i < questionsToProcess.length; i++) {
        const questionData = questionsToProcess[i];
        const globalIndex = startFrom + i + 1;
        const question = questionData.problem || '';
        const expectedAnswer = questionData.expected_answer || '';
        const topic = questionData.topic || '';
        const answerType = questionData.answer_type || '';

        if (!question) {
            log.log(`[${globalIndex}] ⚠ Skipping empty question`);
            continue;
        }

        const shortQ = question.length > 80 ? question.substring(0, 80) + '...' : question;
        log.log(`[${globalIndex}/${end}] ${shortQ}`);

        const totalStart = Date.now();
        let contextSentToLLM = '';
        let llmAnswer = '';
        let judgeVerdict = '';
        let searchTime = 0;
        let llmAnswerTime = 0;
        let llmJudgeTime = 0;
        let searchSuccess = false;
        let llmSuccess = false;
        let error = '';
        let contentFile = '';
        let searchSnippets = '';

        try {
            // ── Step 1: Web Search ──
            log.log('  → Searching web...');
            const searchResult = await searchWeb(question, topN);
            searchTime = searchResult.searchTime;
            searchSuccess = searchResult.success;
            stats.totalSearchTime += searchTime;

            if (searchResult.success) {
                contextSentToLLM = buildContextFromSearch(searchResult);

                // Save FULL content to separate file
                const fullContent = getFullContentForSaving(searchResult);
                contentFile = `q${globalIndex}.txt`;
                const contentPath = path.join(contentDir, contentFile);
                fs.writeFileSync(contentPath, fullContent, 'utf-8');

                // Collect snippets for CSV
                const snippets = (searchResult.searchResults || [])
                    .map(r => r.snippet || '')
                    .filter(Boolean);
                searchSnippets = snippets.join(' | ').substring(0, 500);

                log.log(`  ✓ Search done (${searchTime}ms, ${(searchResult.extractedContent || []).length} sources, ${contextSentToLLM.length} chars context)`);
            } else {
                log.log(`  ✗ Search failed: ${searchResult.error || 'unknown error'}`);
                error = `Search failed: ${searchResult.error || 'unknown'}`;
            }

            // ── Step 2: Ask LLM ──
            if (contextSentToLLM) {
                log.log('  → Asking LLM...');
                const prompt = buildAnswerPrompt(question, contextSentToLLM);
                const llmResult = await askLLM(prompt);
                llmAnswerTime = llmResult.llmTime;
                llmSuccess = llmResult.success;
                stats.totalLLMTime += llmAnswerTime;

                if (llmResult.success) {
                    llmAnswer = llmResult.answer.trim();
                    const shortA = llmAnswer.length > 120 ? llmAnswer.substring(0, 120) + '...' : llmAnswer;
                    log.log(`  ✓ LLM answered (${llmAnswerTime}ms): ${shortA}`);
                } else {
                    log.log(`  ✗ LLM failed: ${llmResult.error}`);
                    error += ` | LLM failed: ${llmResult.error}`;
                }
            } else {
                log.log('  ⚠ No search content available, skipping LLM');
                error += ' | No search content available';
            }

            // ── Step 3: LLM Judge Evaluation ──
            if (llmAnswer && expectedAnswer) {
                log.log('  → Judging answer...');
                const judgeResult = await llmJudge(question, expectedAnswer, llmAnswer);
                judgeVerdict = judgeResult.verdict;
                llmJudgeTime = judgeResult.time;
                stats.totalJudgeTime += llmJudgeTime;

                if (judgeVerdict === 'CORRECT') stats.correct++;
                else if (judgeVerdict === 'INCORRECT') stats.incorrect++;
                else if (judgeVerdict === 'PARTIAL') stats.partial++;
                else stats.unknown++;

                log.log(`  ✓ Verdict: ${judgeVerdict} [${judgeResult.method}] (${llmJudgeTime}ms)`);
                log.log(`    Expected : ${expectedAnswer}`);
                log.log(`    Got      : ${llmAnswer}`);
            }

        } catch (err) {
            log.log(`  ✗ Error: ${err.message}`);
            error = err.message;
            stats.errors++;
        }

        const totalTime = Date.now() - totalStart;
        stats.processed++;

        // ── Calculate running accuracy ──
        const runningAcc = stats.processed > 0
            ? ((stats.correct / stats.processed) * 100).toFixed(1)
            : '0.0';

        // ── Save row to CSV ──
        const row = [
            globalIndex,
            topic,
            answerType,
            question,
            expectedAnswer,
            llmAnswer,
            judgeVerdict,
            `${runningAcc}%`,
            contextSentToLLM.length,
            contentFile,
            searchSnippets,
            searchTime,
            llmAnswerTime,
            llmJudgeTime,
            totalTime,
            searchSuccess,
            llmSuccess,
            error
        ];
        appendResultCSV(outputPath, row);

        log.log(`  📊 Progress: ${stats.processed}/${stats.total} | Accuracy: ${runningAcc}%`);
        log.log('');
    }

    // ── Final Summary ──
    printSummary(stats, outputPath, contentDir, logPath, log);
    log.close();

    return stats;
}

function printSummary(stats, outputPath, contentDir, logPath, log) {
    const pct = (n) => stats.processed > 0 ? ((n / stats.processed) * 100).toFixed(1) : '0.0';
    const avg = (n) => stats.processed > 0 ? (n / stats.processed).toFixed(0) : '0';

    log.log('');
    log.log('╔══════════════════════════════════════════╗');
    log.log('║         BENCHMARK COMPLETE               ║');
    log.log('╚══════════════════════════════════════════╝');
    log.log(`  Total Processed     : ${stats.processed}`);
    log.log(`  Final Accuracy      : ${pct(stats.correct)}%`);
    log.log('');
    log.log('  ── Results ──');
    log.log(`  Correct             : ${stats.correct}  (${pct(stats.correct)}%)`);
    log.log(`  Partial             : ${stats.partial}  (${pct(stats.partial)}%)`);
    log.log(`  Incorrect           : ${stats.incorrect}  (${pct(stats.incorrect)}%)`);
    log.log(`  Unknown/Error       : ${stats.unknown + stats.errors}`);
    log.log('');
    log.log('  ── Timing (averages) ──');
    log.log(`  Avg Search Time     : ${avg(stats.totalSearchTime)}ms`);
    log.log(`  Avg LLM Answer Time : ${avg(stats.totalLLMTime)}ms`);
    log.log(`  Avg Judge Time      : ${avg(stats.totalJudgeTime)}ms`);
    log.log('');
    log.log(`  Results CSV    : ${outputPath}`);
    log.log(`  Log File       : ${logPath}`);
    log.log(`  Full content   : ${contentDir}`);
    log.log('');
}

module.exports = { runBenchmark };
