import { requestBulkApi } from '@/pages/bulk-trader/bulk-api-request';
import { isVerifiedSettlement } from '@/pages/bulk-trader/bulk-contract-monitor';
import { classifyBulkFailure } from '@/pages/bulk-trader/bulk-request-safety';

let nextId = 80000000 + Math.floor(Math.random() * 1000000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const errorMessage = error => error?.message || error?.error?.message || 'Deriv rejected the request.';

/** Send through the existing, authenticated, rate-budgeted Options socket. */
export const nextDigitRequest = (api, payload, canSend, timeout = 15000) =>
    requestBulkApi({ api, payload, canSend, timeout, reqId: ++nextId });

/** Verify contract availability and a broker-reported account balance. */
export const preflightNextDigitAccount = async ({
    api, symbol, accountId, currency, stake, maxTrades, canSend,
}) => {
    const contracts = await nextDigitRequest(api, { contracts_for: symbol }, canSend);
    if (!Array.isArray(contracts?.contracts_for?.available) ||
        !contracts.contracts_for.available.some(item => item.contract_type === 'DIGITMATCH')) {
        throw new Error('Deriv does not offer Digit Matches on this market.');
    }
    const reply = await nextDigitRequest(api, { balance: 1 }, canSend);
    const balance = reply?.balance;
    if (!balance || String(balance.loginid || balance.account_id) !== String(accountId) ||
        balance.currency !== currency || !Number.isFinite(Number(balance.balance)) ||
        Number(balance.balance) < stake * maxTrades) {
        throw new Error('Broker balance, account or currency could not be verified, or balance is below the maximum session stake.');
    }
    return Number(balance.balance);
};

/**
 * Exactly one proposal and one buy per signaled tick. A missing buy reply
 * is UNCONFIRMED, never retried. Settlement is only derived from the broker's
 * verified contract status and profit; no simulated/random outcomes.
 *
 * canBuy checks selected account, symbol, live socket and Start/Stop.
 * canObserve permits a stopped run to reconcile an already-purchased contract.
 */
export const placeNextDigitMatch = async ({
    api, symbol, accountId, currency, digit, stake, canBuy, canObserve,
    onBought = () => {},
}) => {
    if (!/^[A-Za-z0-9_]{2,30}$/.test(symbol) ||
        !Number.isInteger(digit) || digit < 0 || digit > 9 ||
        !Number.isFinite(stake) || stake <= 0 || !accountId || !currency ||
        typeof canBuy !== 'function' || typeof canObserve !== 'function' ||
        !canBuy()) {
        throw new Error('Trading stopped or invalid next-digit order parameters.');
    }

    const proposalResponse = await nextDigitRequest(api, {
        proposal: 1,
        amount: stake,
        basis: 'stake',
        contract_type: 'DIGITMATCH',
        currency,
        duration: 1,
        duration_unit: 't',
        underlying_symbol: symbol,
        barrier: String(digit),
    }, canBuy);

    const proposal = proposalResponse?.proposal;
    const ask = Number(proposal?.ask_price);
    if (!proposal?.id || !Number.isFinite(ask) || ask <= 0 || ask > stake * 1.05) {
        throw new Error('Deriv returned no valid or appropriately priced Digit Matches proposal.');
    }
    if (!canBuy()) {
        const stale = new Error('Signal expired before purchase. No order sent; waiting for a fresh tick.');
        stale.staleSignal = true;
        throw stale;
    }

    let bought;
    try {
        bought = await nextDigitRequest(api, { buy: proposal.id, price: ask }, canBuy);
    } catch (error) {
        const classification = classifyBulkFailure(error, 'buy');
        if (classification.status === 'unconfirmed') {
            const uncertain = new Error(
                'Purchase confirmation was lost. Check Deriv account statement; automatic trading is blocked. ' + errorMessage(error)
            );
            uncertain.unconfirmed = true;
            throw uncertain;
        }
        throw error;
    }

    if (!bought?.buy?.contract_id) {
        const uncertain = new Error(
            'Purchase response had no contract ID. Check Deriv statement; automatic trading is blocked.'
        );
        uncertain.unconfirmed = true;
        throw uncertain;
    }
    const contractId = String(bought.buy.contract_id);
    const price = Number(bought.buy.buy_price ?? ask);
    onBought({ contractId, price, symbol, digit, accountId });

    // Do not issue another order until Deriv confirms settlement.
    for (let poll = 0; poll < 15; poll += 1) {
        if (!canObserve()) {
            const uncertain = new Error('Account changed or WebSocket disconnected before settlement. Reconcile contract ' + contractId + ' manually.');
            uncertain.unconfirmed = true;
            throw uncertain;
        }
        await sleep(poll === 0 ? 1200 : 2000);
        try {
            const reply = await nextDigitRequest(
                api, { proposal_open_contract: 1, contract_id: Number(contractId) }, canObserve, 12000
            );
            const contract = reply?.proposal_open_contract;
            if (isVerifiedSettlement(contract) && String(contract.contract_id) === contractId) {
                return {
                    contractId,
                    price: Number.isFinite(price) ? price : ask,
                    profit: Number(contract.profit),
                    status: Number(contract.profit) >= 0 ? 'won' : 'lost',
                    symbol, digit, accountId,
                };
            }
        } catch (error) {
            if (!canObserve()) break;
            // A transient status-request error does not justify a second buy.
        }
    }
    const unresolved = new Error('Contract ' + contractId + ' has no verified settlement yet. Check Deriv statement before rearming.');
    unresolved.unconfirmed = true;
    throw unresolved;
};
