/**
 * Interpret recent tick last-digits using the selected Bulk Trader contract pair.
 * Tones follow the order of the buy buttons: first = teal, second = red.
 * For Over/Under, a digit equal to the prediction is neither, so it is neutral.
 * Rise/Fall cannot be inferred from last-digits alone; show the raw digit.
 */
export const getRecentTickOutcome = (digit, tradeType, prediction) => {
    const value = Number(digit);
    const barrier = Number(prediction);
    const neutral = (letter, description) => ({ letter, tone: 'neutral', description });

    if (!Number.isInteger(value) || value < 0 || value > 9) {
        return neutral('—', 'No valid digit');
    }

    if (tradeType === 'EVEN_ODD') {
        return value % 2 === 0
            ? { letter: 'E', tone: 'primary', description: 'Even' }
            : { letter: 'O', tone: 'secondary', description: 'Odd' };
    }

    if (tradeType === 'RISE_FALL') {
        return neutral(String(value), 'Last digit (not a Rise/Fall signal)');
    }

    if (!Number.isInteger(barrier) || barrier < 0 || barrier > 9) {
        return neutral('—', 'Choose a valid prediction');
    }

    if (tradeType === 'OVER_UNDER') {
        if (value === barrier) return neutral('=', 'Equals prediction (neither Over nor Under)');
        return value < barrier
            ? { letter: 'U', tone: 'primary', description: 'Under' }
            : { letter: 'O', tone: 'secondary', description: 'Over' };
    }

    if (tradeType === 'MATCH_DIFF') {
        return value === barrier
            ? { letter: 'M', tone: 'secondary', description: 'Matches' }
            : { letter: 'D', tone: 'primary', description: 'Differs' };
    }

    return neutral(String(value), 'Last digit');
};
