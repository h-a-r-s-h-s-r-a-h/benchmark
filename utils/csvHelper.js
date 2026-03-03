const fs = require('fs');

/**
 * Parse a CSV line handling quoted fields with commas, newlines, and escaped quotes.
 */
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

/**
 * Read and parse a CSV file into an array of objects.
 */
function parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Handle multi-line quoted fields by re-joining lines inside quotes
    const rawLines = content.split('\n');
    const lines = [];
    let buffer = '';
    let inQuotes = false;

    for (const rawLine of rawLines) {
        buffer += (buffer ? '\n' : '') + rawLine;
        // Count unescaped quotes to track state
        for (const ch of rawLine) {
            if (ch === '"') inQuotes = !inQuotes;
        }
        if (!inQuotes) {
            lines.push(buffer);
            buffer = '';
        }
    }
    if (buffer) lines.push(buffer);

    if (lines.length === 0) return [];

    const headers = parseCSVLine(lines[0]);
    const records = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCSVLine(line);
        const record = {};
        headers.forEach((h, idx) => {
            record[h.trim()] = values[idx] !== undefined ? values[idx].trim() : '';
        });
        records.push(record);
    }

    return records;
}

/**
 * Escape a field for CSV output.
 */
function escapeCSVField(field) {
    if (field === null || field === undefined) return '';
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

/**
 * Initialize a results CSV file with headers.
 */
function initResultsCSV(filePath, headers) {
    const headerLine = headers.map(escapeCSVField).join(',');
    fs.writeFileSync(filePath, headerLine + '\n', 'utf-8');
}

/**
 * Append a single row to the results CSV.
 */
function appendResultCSV(filePath, row) {
    const line = row.map(escapeCSVField).join(',');
    fs.appendFileSync(filePath, line + '\n', 'utf-8');
}

module.exports = { parseCSV, initResultsCSV, appendResultCSV };
