/**
 * Alphapips temporary wordmark. Replace the AP monogram when the client
 * supplies the official brand artwork; do not reuse another client's logo.
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
    <span className={`alphapips-brand-logo ${className}`} style={{ width, height }} aria-label='Alphapips'>
        <img
            className='alphapips-brand-logo__mark'
            src='/alphapips-mark.svg'
            alt=''
            width={height}
            height={height}
            decoding='async'
        />
        <span className='alphapips-brand-logo__text'>Alphapips</span>
    </span>
);
