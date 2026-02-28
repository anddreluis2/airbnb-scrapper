import { createWriteStream, existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { ListingData } from '../types.js';
import { CONFIG } from '../config.js';

export class CSVWriter {
  private filePath: string;
  private headerWritten: boolean = false;

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

  async writeHeader(): Promise<void> {
    if (this.headerWritten) {
      return;
    }

    const header = CONFIG.output.headers.join(',') + '\n';
    const stream = createWriteStream(this.filePath, { flags: 'w' });

    return new Promise((resolve, reject) => {
      stream.write(header, (error) => {
        if (error) reject(error);
        else {
          this.headerWritten = true;
          stream.end();
          resolve();
        }
      });
    });
  }

  async appendRow(data: ListingData): Promise<void> {
    if (!this.headerWritten) {
      await this.writeHeader();
    }

    const row = this.formatRow(data);
    const stream = createWriteStream(this.filePath, { flags: 'a' });

    return new Promise((resolve, reject) => {
      stream.write(row + '\n', (error) => {
        if (error) reject(error);
        stream.end();
        resolve();
      });
    });
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
}
