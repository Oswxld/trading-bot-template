/**
 * Client-provided Yolo Traders bull illustration, optimized for the header.
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
    <span className={`yolo-brand-logo ${className}`} style={{ width, height }} aria-label='Yolo Traders'>
        <img
            className='yolo-brand-logo__mark'
            src='/yolo-traders-mark.png'
            alt=''
            width={height}
            height={height}
            decoding='async'
        />
        <span className='yolo-brand-logo__text'>Yolo Traders</span>
    </span>
);
