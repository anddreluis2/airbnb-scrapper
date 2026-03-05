import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { CSVWriter } from '../../src/output/csv-writer.js';
import { ListingData } from '../../src/types.js';

const TEST_DIR = join(process.cwd(), 'tests', '.tmp');
const TEST_FILE = join(TEST_DIR, 'test-output.csv');

function makeListing(overrides: Partial<ListingData> = {}): ListingData {
  return {
    listing_id: '12345',
    url: 'https://www.airbnb.com.br/rooms/12345',
    titulo: 'Apartamento Centro',
    localizacao: 'Centro, Curitiba',
    anfitriao: 'Tom',
    coordenadas: '-25.4284,-49.2733',
    coletado_em: '2024-01-15',
    ...overrides,
  };
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe('CSVWriter', () => {
  it('creates file with header on first write', async () => {
    const writer = new CSVWriter(TEST_FILE);
    await writer.appendRow(makeListing());

    const content = readFileSync(TEST_FILE, 'utf-8');
    const lines = content.trim().split('\n');

    expect(lines[0]).toBe('listing_id,url,titulo,localizacao,anfitriao,coordenadas,coletado_em');
    expect(lines).toHaveLength(2);
  });

  it('appends multiple rows', async () => {
    const writer = new CSVWriter(TEST_FILE);
    await writer.appendRow(makeListing({ listing_id: '111' }));
    await writer.appendRow(makeListing({ listing_id: '222' }));
    await writer.appendRow(makeListing({ listing_id: '333' }));

    const content = readFileSync(TEST_FILE, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(4);
  });

  it('escapes commas in values', async () => {
    const writer = new CSVWriter(TEST_FILE);
    await writer.appendRow(makeListing({ titulo: 'Apt bonito, aconchegante' }));

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('"Apt bonito, aconchegante"');
  });

  it('escapes double quotes in values', async () => {
    const writer = new CSVWriter(TEST_FILE);
    await writer.appendRow(makeListing({ titulo: 'Apt "Luxo" Centro' }));

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('"Apt ""Luxo"" Centro"');
  });

  it('escapes newlines in values', async () => {
    const writer = new CSVWriter(TEST_FILE);
    await writer.appendRow(makeListing({ titulo: 'Linha 1\nLinha 2' }));

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('"Linha 1\nLinha 2"');
  });

  it('handles null coordenadas', async () => {
    const writer = new CSVWriter(TEST_FILE);
    await writer.appendRow(makeListing({ coordenadas: null }));

    const content = readFileSync(TEST_FILE, 'utf-8');
    const dataLine = content.trim().split('\n')[1];
    expect(dataLine).toContain(',,');
  });

  it('creates directory if it does not exist', async () => {
    const nestedPath = join(TEST_DIR, 'nested', 'deep', 'output.csv');
    const writer = new CSVWriter(nestedPath);
    await writer.appendRow(makeListing());

    expect(existsSync(nestedPath)).toBe(true);
  });

  it('getFilePath returns configured path', () => {
    const writer = new CSVWriter(TEST_FILE);
    expect(writer.getFilePath()).toBe(TEST_FILE);
  });

  it('getRowCount returns 0 for non-existent file', () => {
    const writer = new CSVWriter(join(TEST_DIR, 'nonexistent.csv'));
    expect(writer.getRowCount()).toBe(0);
  });

  it('getRowCount returns correct count after writes', async () => {
    const writer = new CSVWriter(TEST_FILE);
    await writer.appendRow(makeListing({ listing_id: '1' }));
    await writer.appendRow(makeListing({ listing_id: '2' }));

    expect(writer.getRowCount()).toBe(2);
  });

  it('loadExistingIds returns empty set for non-existent file', () => {
    const writer = new CSVWriter(join(TEST_DIR, 'ghost.csv'));
    expect(writer.loadExistingIds().size).toBe(0);
  });

  it('loadExistingIds returns IDs from existing CSV', async () => {
    const writer = new CSVWriter(TEST_FILE);
    await writer.appendRow(makeListing({ listing_id: 'aaa' }));
    await writer.appendRow(makeListing({ listing_id: 'bbb' }));
    await writer.appendRow(makeListing({ listing_id: 'ccc' }));

    const ids = new CSVWriter(TEST_FILE).loadExistingIds();
    expect(ids.size).toBe(3);
    expect(ids.has('aaa')).toBe(true);
    expect(ids.has('bbb')).toBe(true);
    expect(ids.has('ccc')).toBe(true);
    expect(ids.has('zzz')).toBe(false);
  });
});
