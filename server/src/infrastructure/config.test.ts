import { describe, expect, it } from 'vitest';
import { describeTarget, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('throws naming DATABASE_URL when missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('defaults port to 3000 and fixes host to 127.0.0.1', () => {
    const cfg = loadConfig({ DATABASE_URL: 'postgres://u:p@h:5432/d' });
    expect(cfg.port).toBe(3000);
    expect(cfg.host).toBe('127.0.0.1');
  });

  it('parses PORT and rejects invalid values', () => {
    expect(loadConfig({ DATABASE_URL: 'x', PORT: '4010' }).port).toBe(4010);
    expect(() => loadConfig({ DATABASE_URL: 'x', PORT: 'abc' })).toThrow(/PORT/);
  });
});

describe('describeTarget', () => {
  it('shows host:port/db and hides the password', () => {
    const out = describeTarget('postgres://u:secret@h:5432/d');
    expect(out).toBe('h:5432/d');
    expect(out).not.toContain('secret');
  });

  it('never echoes an invalid url', () => {
    expect(describeTarget('not a url secret')).not.toContain('secret');
  });
});
