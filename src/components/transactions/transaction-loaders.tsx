import React from 'react';
import ContentLoader from 'react-content-loader';

/**
 * Native Deriv Bot transaction placeholders, shared with Bulk Trader.
 * Keep the original shimmer, sizes, timing and theme variables so pending
 * Bulk Trader contracts animate exactly like Deriv Bot transactions.
 */
export const TransactionFieldLoader: React.FC = () => (
    <ContentLoader
        className='transactions__loader-text'
        height={10}
        width={80}
        speed={3}
        backgroundColor='var(--general-section-2)'
        foregroundColor='var(--general-hover)'
        aria-label='Waiting for contract update'
        role='img'
    >
        <rect x='0' y='0' rx='0' ry='0' width='100' height='12' />
    </ContentLoader>
);

export const TransactionIconLoader: React.FC = () => (
    <ContentLoader
        className='transactions__loader-icon'
        speed={3}
        width={24}
        height={24}
        backgroundColor='var(--general-section-1)'
        foregroundColor='var(--general-hover)'
        aria-label='Loading contract type'
        role='img'
    >
        <rect x='0' y='0' rx='5' ry='5' width='24' height='24' />
    </ContentLoader>
);
