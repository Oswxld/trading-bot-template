import {
    isTradingRateLimitError,
    noteTradingRateLimit,
    sendTradingRequestWithinBudget,
} from '@/services/trading-request-budget';
import { makeBulkRequestError } from './bulk-request-safety';

const messageFor = error => error?.message || error?.error?.message || 'The trading request was rejected.';

/**
 * Execute one Deriv WebSocket request, correlating the authoritative reply by
 * req_id. A request that may have left the browser cannot be safely retried
 * merely because its response was lost.
 *
 * The budget gate controls dispatch only; it must never wait for the broker's
 * reply. The timeout starts when api.send() is attempted, not while queued.
 */
export const requestBulkApi = ({
    api,
    payload,
    reqId,
    timeout = 15000,
    canSend = () => true,
    onThrottle,
}) => new Promise((resolve, reject) => {
    const requestType = Object.prototype.hasOwnProperty.call(payload, 'buy') ? 'buy' :
        Object.prototype.hasOwnProperty.call(payload, 'proposal') ? 'proposal' : 'status';
    let subscription;
    let timer;
    let finished = false;
    let dispatched = false;
    let rateLimitReported = false;

    const failure = (kind, message, code) => makeBulkRequestError(message, {
        kind,
        dispatched,
        requestType,
        apiCode: code,
    });
    const noteRateLimitOnce = error => {
        if (!rateLimitReported && isTradingRateLimitError(error)) {
            rateLimitReported = true;
            noteTradingRateLimit(api);
        }
    };
    const onSocketClose = () => done(failure(
        'connection_lost',
        'Deriv WebSocket disconnected before confirming the request. Check the account statement for any outstanding purchase.'
    ));
    const done = (error, data) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        subscription?.unsubscribe?.();
        api.connection?.removeEventListener?.('close', onSocketClose);
        if (error) reject(error);
        else resolve(data);
    };

    try {
        if (!Number.isInteger(reqId) || reqId <= 0) {
            throw new Error('Missing request correlation ID.');
        }
        api.connection?.addEventListener?.('close', onSocketClose);
        subscription = api.onMessage().subscribe(event => {
            const data = event?.data || event;
            if (Number(data?.req_id) !== reqId) return;
            if (data.error) {
                noteRateLimitOnce(data.error);
                done(failure('api_rejected', messageFor(data.error), data.error.code));
            } else {
                done(null, data);
            }
        });

        const send = () => {
            if (finished) return;
            dispatched = true; // Conservatively uncertain if api.send throws.
            timer = setTimeout(() => done(failure(
                'timeout',
                'Deriv did not confirm this request within the timeout. Check the account statement before buying again.'
            )), timeout);
            const result = api.send({ ...payload, req_id: reqId });
            // A send promise rejection is not proof that Deriv did not buy.
            // Confirmations are matched using onMessage and req_id.
            result?.catch?.(error => {
                noteRateLimitOnce(error);
                done(failure('send_rejected', messageFor(error), error?.code));
            });
        };

        const tradingRequest = ['proposal', 'buy', 'sell', 'proposal_open_contract']
            .some(key => Object.prototype.hasOwnProperty.call(payload, key));

        if (tradingRequest) {
            sendTradingRequestWithinBudget(api, send, canSend, onThrottle).catch(error => {
                const cancelled = !dispatched &&
                    String(error?.message || '').includes('Bulk trading stopped before sending this request.');
                done(failure(cancelled ? 'cancelled' : 'dispatch_error', messageFor(error)));
            });
        } else {
            send();
        }
    } catch (error) {
        done(failure('dispatch_error', messageFor(error)));
    }
});
