/**
 * Client-provided SheedyTraders bull illustration, optimized for the header.
 * Rendering the wordmark as text keeps it crisp and readable.
 */
type TBrandLogoProps = {
    width?: number;
    height?: number;
    fill?: string;
    className?: string;
};

export const BrandLogo = ({
    width = 180,
    height = 36,
    className = '',
}: TBrandLogoProps) => (
    <span className={`sheedytraders-brand-logo ${className}`} style={{ width, height }} aria-label='SheedyTraders'>
        <img
            className='sheedytraders-brand-logo__mark'
            src='/sheedytraders-mark.webp'
            alt=''
            width={height}
            height={height}
            decoding='async'
        />
        <span className='sheedytraders-brand-logo__text'>SheedyTraders</span>
    </span>
);
