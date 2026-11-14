/**
 * Pitprinter header logo: compact icon plus a separate, readable wordmark.
 * Do not put the full banner image in the narrow header slot.
 */
type TBrandLogoProps = {
    width?: number;
    height?: number;
    fill?: string;
    className?: string;
};

export const BrandLogo = ({
    width = 210,
    height = 42,
    className = '',
}: TBrandLogoProps) => (
    <span className={`pitprinter-brand-logo ${className}`} style={{ maxWidth: width, height }} aria-label='Pitprinter'>
        <img
            className='pitprinter-brand-logo__mark'
            src='/pitprinter-icon.webp'
            alt=''
            width={36}
            height={36}
            decoding='async'
        />
        <span className='pitprinter-brand-logo__name'>
            <span>Pit</span>
            <span className='pitprinter-brand-logo__accent'>printer</span>
        </span>
    </span>
);
