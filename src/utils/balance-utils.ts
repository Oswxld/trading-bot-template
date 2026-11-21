/** Parse the broker's numeric or decimal-string balance. Zero is valid; absent,
 * empty, NaN, and infinite responses are not verified balances. */
export const parseFiniteBalance = (value: unknown): number | null => {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
};
