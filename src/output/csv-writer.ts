import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { mkdirSync } from 'fs';
import { ListingData } from '../types.js';
import { CONFIG } from '../config.js';

export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

export class CSVWriter {
  private filePath: string;
  private headerWritten: boolean = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(filePath: string = CONFIG.output.filePath) {
    this.filePath = filePath;
    this.ensureDirectory();
    this.headerWritten = existsSync(filePath);
  }

  private ensureDirectory(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private writeHeader(): void {
    if (this.headerWritten) return;
    const header = CONFIG.output.headers.join(',') + '\n';
    writeFileSync(this.filePath, header, 'utf-8');
    this.headerWritten = true;
  }

  async appendRow(data: ListingData): Promise<void> {
    this.writeLock = this.writeLock.then(() => {
      if (!this.headerWritten) {
        this.writeHeader();
      }
      const row = this.formatRow(data);
      appendFileSync(this.filePath, row + '\n', 'utf-8');
    });
    await this.writeLock;
  }

  private formatRow(data: ListingData): string {
    return CONFIG.output.headers
      .map((header) => {
        const value = data[header as keyof ListingData] || '';
        return this.escapeCSV(String(value));
      })
      .join(',');
  }

  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getRowCount(): number {
    if (!existsSync(this.filePath)) {
      return 0;
    }

    const content = readFileSync(this.filePath, 'utf-8');
    const lines = content.trim().split('\n');
    return Math.max(0, lines.length - 1);
  }

  loadExistingIds(): Set<string> {
    const ids = new Set<string>();
    if (!existsSync(this.filePath)) return ids;

    const content = readFileSync(this.filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const idIndex = CONFIG.output.headers.indexOf('listing_id');
    if (idIndex === -1) return ids;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const id = cols[idIndex]?.trim();
      if (id) ids.add(id);
    }

    return ids;
  }
}
