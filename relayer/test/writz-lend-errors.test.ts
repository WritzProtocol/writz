/**
 * The relayer's copy of the WritzLendError codes must match the contract, or
 * a failed deposit would be reported under the wrong name.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WRITZ_LEND_ERRORS } from '../src/lend/writz-lend-errors.js';

const ERROR_RS = join(__dirname, '..', '..', 'contracts', 'contracts', 'writz-lend', 'src', 'error.rs');

test('WRITZ_LEND_ERRORS matches contracts/contracts/writz-lend/src/error.rs', () => {
  const source = readFileSync(ERROR_RS, 'utf8');
  const body = source.slice(source.indexOf('pub enum WritzLendError'));
  const variants = Object.fromEntries(
    [...body.matchAll(/^\s*([A-Z]\w*)\s*=\s*(\d+),/gm)].map(([, name, code]) => [Number(code), name]),
  );
  expect(Object.keys(variants).length).toBeGreaterThan(20);
  expect(WRITZ_LEND_ERRORS).toEqual(variants);
});
