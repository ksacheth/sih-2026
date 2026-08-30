/**
 * Pure Verhoeff algorithm implementation for Indian Aadhaar / UID validation & test generation.
 * D: Dihedral group D5 multiplication table (10x10)
 * P: Permutation table (8x10)
 */

export const D: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

export const P: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/**
 * Validates a number string using the Verhoeff algorithm.
 * Digits are processed right-to-left, with row 0 of P at the rightmost position.
 */
export function verhoeffValidate(numStr: string): boolean {
  const clean = numStr.replace(/\D/g, "");
  if (!clean) return false;

  const digits = clean.split("").map(Number).reverse();
  let c = 0;

  for (let i = 0; i < digits.length; i++) {
    c = D[c][P[i % 8][digits[i]]];
  }

  return c === 0;
}

/**
 * Generates the exact Verhoeff check digit for an input body (e.g. 11 digits).
 * Uses exact inverse-chain walking to guarantee correct check-digit generation (100% accurate).
 */
export function verhoeffCheckDigit(body: string): number {
  const clean = body.replace(/\D/g, "");
  const b = clean.split("").map(Number).reverse();
  let state = 0;

  for (let i = b.length - 1; i >= 0; i--) {
    const x = P[(i + 1) % 8][b[i]];
    state = D.findIndex((row) => row[x] === state);
  }

  return state;
}
