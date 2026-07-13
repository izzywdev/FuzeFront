import { CSSProperties, ChangeEventHandler } from "react";

export interface ToggleProps {
  checked?: boolean;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
  label?: string;
  id?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function Toggle(props: ToggleProps): JSX.Element;
