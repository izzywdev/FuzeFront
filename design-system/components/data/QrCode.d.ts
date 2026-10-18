import * as React from "react";

/**
 * QR code renderer for a precomputed module matrix (the caller owns the
 * encoder). Always dark-on-light so it scans in either theme.
 */
export interface QrCodeProps extends Omit<React.SVGAttributes<SVGSVGElement>, "children"> {
  /** `modules[row][col] === true` is a dark module. Square matrix. */
  modules: boolean[][];
  /** Accessible name. Default "QR code". */
  label?: string;
  /** CSS size (width = height). Default a 168px token expression. */
  size?: string;
  /** Quiet-zone width in modules. Default 2. */
  quietZone?: number;
}

export function QrCode(props: QrCodeProps): React.JSX.Element | null;
