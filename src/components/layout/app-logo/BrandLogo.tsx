/**
 * Official Alphapips artwork supplied by the client.
 * The header uses its bull-and-candlestick portion at small sizes, with a
 * readable text label. The original composition is available as a complete
 * logo asset at /alphapips-brand.webp and is also used for social previews.
 */
type TBrandLogoProps = {
    width?: number;
    height?: number;
    fill?: string;
    className?: string;
};

export const BrandLogo = ({
    width = 210,
    height = 36,
    className = '',
}: TBrandLogoProps) => (
    <span className={`alphapips-brand-logo ${className}`} style={{ width, height }} aria-label='Alphapips Trading and Web3 Hub'>
        <span className='alphapips-brand-logo__mark' aria-hidden='true' />
        <span className='alphapips-brand-logo__text'>Alphapips</span>
    </span>
);
