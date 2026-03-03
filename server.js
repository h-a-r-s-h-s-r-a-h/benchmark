require('dotenv').config();
const { runBenchmark } = require('./controllers/benchmarkController');

const limit = parseInt(process.env.BENCHMARK_LIMIT || '0') || 0;
const startFrom = parseInt(process.env.BENCHMARK_START || '0') || 0;
const topN = parseInt(process.env.BENCHMARK_TOP_N || '2') || 2;

async function main() {
    try {
        console.log('Starting benchmark...');
        console.log(`Config: LIMIT=${limit}, START=${startFrom}, TOP_N=${topN}`);

        const stats = await runBenchmark({
            limit,
            startFrom,
            topN
        });

        console.log('Benchmark finished successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Benchmark failed:', error.message);
        process.exit(1);
    }
}

main();
