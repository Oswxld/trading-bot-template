/**
 * MobilityTradersHub emblem supplied by the client (cropped from the provided logo).
 * Render the brand name as text next to it so it remains legible in the header.
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
    <span className={`apex-brand-logo ${className}`} style={{ width, height }} aria-label='MobilityTradersHub'>
        <img
            className='apex-brand-logo__mark'
            src='/mobiletradershub-mark.webp'
            alt=''
            width={height}
            height={height}
            decoding='async'
        />
        <span className='apex-brand-logo__text'>MobilityTradersHub</span>
    </span>
);
