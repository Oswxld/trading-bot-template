import {
    acquireBulkRun,
    classifyBulkFailure,
    makeBulkRequestError,
    releaseBulkRun,
} from '../bulk-request-safety';

const errorFor = (kind, dispatched, phase = 'buy') =>
    makeBulkRequestError('Simulated Deriv response', {
        kind, dispatched, requestType: phase,
    });

describe('Bulk Trader order-safety decisions', () => {
    afterEach(() => {
        releaseBulkRun('VRTC_DEMO_1');
        releaseBulkRun('VRTC_DEMO_2');
    });

    it('prevents a second batch on the same account until the first releases', () => {
        expect(acquireBulkRun('VRTC_DEMO_1')).toBe(true);
        expect(acquireBulkRun('VRTC_DEMO_1')).toBe(false);
        expect(acquireBulkRun('VRTC_DEMO_2')).toBe(true);
        releaseBulkRun('VRTC_DEMO_1');
        expect(acquireBulkRun('VRTC_DEMO_1')).toBe(true);
    });

    it('classifies Stop before a queued buy sends as skipped, never uncertain', () => {
        expect(classifyBulkFailure(errorFor('cancelled', false), 'buy')).toEqual({
            status: 'skipped', stop: false, requiresStatementCheck: false,
        });
    });

    it('treats a verified API rejection for the matching buy req_id as failed', () => {
        expect(classifyBulkFailure(errorFor('api_rejected', true), 'buy')).toEqual({
            status: 'failed', stop: false, requiresStatementCheck: false,
        });
    });

    it.each(['timeout', 'connection_lost', 'send_rejected', 'dispatch_error'])(
        'never treats a potentially dispatched %s buy as a definite failure',
        kind => {
            expect(classifyBulkFailure(errorFor(kind, true), 'buy')).toEqual({
                status: 'unconfirmed', stop: true, requiresStatementCheck: true,
            });
        }
    );

    it('treats a missing purchase confirmation as unconfirmed and stops future starts', () => {
        const error = new Error('Missing buy.contract_id');
        expect(classifyBulkFailure(error, 'buy')).toEqual({
            status: 'unconfirmed', stop: true, requiresStatementCheck: true,
        });
    });

    it('does not misclassify a quote timeout as a purchased contract', () => {
        expect(classifyBulkFailure(errorFor('timeout', true, 'proposal'), 'proposal')).toEqual({
            status: 'failed', stop: true, requiresStatementCheck: false,
        });
    });

    it('halts on local dispatch failure without falsely claiming money was spent', () => {
        expect(classifyBulkFailure(errorFor('dispatch_error', false), 'buy')).toEqual({
            status: 'failed', stop: true, requiresStatementCheck: false,
        });
    });

    it('allows normal quote API rejection to fail without marking a buy unconfirmed', () => {
        expect(classifyBulkFailure(errorFor('api_rejected', true, 'proposal'), 'proposal')).toEqual({
            status: 'failed', stop: false, requiresStatementCheck: false,
        });
    });
});
