/**
 * Compact rendering of the client's supplied Pitprinter artwork.
 * The original mark and lettering are preserved in /pitprinter-logo.webp.
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
    <img
        className={`pitprinter-brand-logo ${className}`}
        src='/pitprinter-logo.webp'
        alt='Pitprinter'
        width={width}
        height={height}
        decoding='async'
        style={{ width, height }}
    />
);
