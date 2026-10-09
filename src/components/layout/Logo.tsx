import logoUrl from '../../assets/encirra-logo.png';

/** ENCIRRA mark (brand logo, rendered from the raster master in src/assets). */
export function LogoMark({ size = 24 }: { size?: number }) {
  return <img src={logoUrl} width={size} height={size} alt="" aria-hidden draggable={false} className="shrink-0 select-none" style={{ width: size, height: size }} />;
}
