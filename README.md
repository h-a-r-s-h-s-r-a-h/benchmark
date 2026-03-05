# SimpleQA Benchmark System

A benchmark system that evaluates **Llama 3.2 (3B)** on 4,326 factual questions from the SimpleQA dataset. It searches the web for context using the [Keiro Labs API](https://www.keirolabs.cloud/docs), feeds it to the LLM, and evaluates the answer — all automatically.

## 📊 Results

Download the full benchmark results (CSVs + logs):  
**[Google Drive →](https://drive.google.com/drive/folders/17LFWFYafVlp0BfY6CfV9Hq3TP8GXNsOY?usp=sharing)**

## How It Works

```
Question → Keiro Web Search → Context (6K chars) → Llama 3.2 → Answer → Evaluate
```

1. Reads questions from `simpleqa_full_dataset.csv`
2. Searches the web via **Keiro research-pro API** for relevant context
3. Sends context + question to **Llama 3.2 (3B)** running locally via Ollama
4. Evaluates the answer using a hybrid judge (smart string match + LLM judge)
5. Saves results to CSV with running accuracy after each question

## Prerequisites

- **Node.js** (v18+)
- **Ollama** with `llama3.2` model pulled
- **Keiro Labs API key** ([get one here](https://www.keirolabs.cloud/docs))

## Setup

### 1. Install Ollama & Pull the Model

```bash
# Install Ollama (Linux)
curl -fsSL https://ollama.ai/install.sh | sh

# Pull llama3.2 (3B)
ollama pull llama3.2

# Verify it's running
ollama list
```

### 2. Clone & Install Dependencies

```bash
git clone https://github.com/h-a-r-s-h-s-r-a-h/benchmark.git
cd benchmark
npm install
```

### 3. Configure Environment

Create a `.env` file:

```env
# Keiro Labs API Key (get from https://www.keirolabs.cloud/docs)
KEIRO_API="your_keiro_api_key_here"

# Ollama LLM (default local)
LLM_LINK=http://localhost:11434/api/generate
LLM_MODEL_NAME=llama3.2

# Benchmark config
BENCHMARK_LIMIT=0        # 0 = all questions, or set a number
BENCHMARK_START=0        # Start from question N
BENCHMARK_TOP_N=5        # Search results per question
```

### 4. Run the Benchmark

```bash
npm start
```

## Output Files

Each run generates 3 types of output:

| File | Description |
|------|-------------|
| `benchmark_results_*.csv` | Full results with running accuracy |
| `benchmark_results_*_log.txt` | Clean text log (mirrors console output) |
| `web_content/q1.txt, q2.txt, ...` | Full crawled web content per question |

### CSV Columns

| Column | Description |
|--------|-------------|
| `index` | Question number |
| `question` | The factual question |
| `expected_answer` | Ground truth answer |
| `llm_answer` | Model's answer |
| `llm_judge_verdict` | CORRECT / INCORRECT |
| `running_accuracy` | Accuracy so far (e.g., "82.5%") |
| `context_sent_to_llm_chars` | Context size sent to model |
| `search_time_ms` | Web search latency |
| `llm_answer_time_ms` | Model response time |

## Project Structure

```
benchmark/
├── server.js                    # Entry point
├── controllers/
│   └── benchmarkController.js   # Main benchmark pipeline
├── utils/
│   ├── webSearch.js             # Keiro API integration
│   ├── llm.js                   # Ollama LLM calls & prompts
│   ├── evaluator.js             # Hybrid answer evaluator
│   └── csvHelper.js             # CSV read/write helpers
├── simpleqa_full_dataset.csv    # 4,326 questions
├── .env                         # Config (API keys, settings)
└── package.json
```

## Key Design Decisions

- **Context capped at 6K chars** — Llama 3.2 (3B) performs best with focused context rather than overwhelming amounts of text
- **Snippets prioritized** — Search snippets are included first (most relevant), then full article content fills remaining space
- **Hybrid evaluator** — Uses smart string matching first (catches obvious matches reliably), falls back to LLM judge only for ambiguous cases
- **Non-answer filter** — Automatically rejects responses like "not mentioned" or "I don't know"

## Configuration Tips

- **Resume from a specific question**: Set `BENCHMARK_START=500` to skip the first 500
- **Test on a small batch**: Set `BENCHMARK_LIMIT=50` to only process 50 questions
- **Adjust search depth**: `BENCHMARK_TOP_N=3` for fewer but faster results

## Llama 3.2 Without Keiro (Baseline)

For comparison, running SimpleQA with **only Llama 3.2 (3B)** and no web search context scores **3.33% accuracy**.

- **Repo**: [github.com/h-a-r-s-h-s-r-a-h/llamaBenchmark](https://github.com/h-a-r-s-h-s-r-a-h/llamaBenchmark.git)
- **Results**: [Download from Google Drive](https://drive.google.com/drive/folders/1xrjJYE3BFkG3SAIe7ifq0jLyAhzCDbKk?usp=sharing)

This shows that web search context from Keiro is critical — it takes accuracy from **3.33% → 80%+**.

## License

ISC
