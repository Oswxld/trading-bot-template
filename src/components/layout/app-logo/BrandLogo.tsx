/**
 * Client-provided Pipprinter candlestick P mark, optimized for the header.
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
    <span className={`pipprinter-brand-logo ${className}`} style={{ width, height }} aria-label='Pipprinter'>
        <img
            className='pipprinter-brand-logo__mark'
            src='/pipprinter-mark.jpg'
            alt=''
            width={height}
            height={height}
            decoding='async'
        />
        <span className='pipprinter-brand-logo__text'>Pipprinter</span>
    </span>
);
