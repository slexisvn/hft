import { describe, expect, it } from 'vitest';
import { formatCell, parseCsv } from '@hft/contracts';

describe('csv parsing is symmetric with formatCell', () => {
  it('round-trips a field containing a comma', () => {
    const encoded = `x,${formatCell('a,b')},y`;
    expect(parseCsv(`h\n${encoded}`).rows[0]).toEqual(['x', 'a,b', 'y']);
  });

  it('round-trips a field containing an escaped double quote', () => {
    const encoded = formatCell('a"b');
    expect(parseCsv(`h\n${encoded}`).rows[0]).toEqual(['a"b']);
  });

  it('round-trips a field containing a newline', () => {
    const encoded = formatCell('a\nb');
    const csv = `h\n${encoded}\n`;
    expect(parseCsv(csv).rows[0]).toEqual(['a\nb']);
  });

  it('preserves empty trailing fields', () => {
    expect(parseCsv('h1,h2,h3\n1,,3').rows[0]).toEqual(['1', '', '3']);
  });

  it('tolerates CRLF line endings', () => {
    expect(parseCsv('h1,h2\r\n1,2\r\n').rows[0]).toEqual(['1', '2']);
  });
});
