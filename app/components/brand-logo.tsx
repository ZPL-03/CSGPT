import type { CSSProperties } from "react";
import Image from "next/image";

export function BrandLogo(props: {
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const size = props.size ?? 48;
  return (
    <Image
      src="/favicon.png"
      alt="CSGPT"
      width={size}
      height={size}
      draggable={false}
      unoptimized
      className={props.className}
      style={{
        display: "block",
        width: size,
        height: size,
        objectFit: "contain",
        ...props.style,
      }}
    />
  );
}
