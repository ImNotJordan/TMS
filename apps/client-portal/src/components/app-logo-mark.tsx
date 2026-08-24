import { cn } from "@/lib/utils";

export const APP_LOGO_SRC = "/logo.png";

type AppLogoMarkProps = {
  className?: string;
  imgClassName?: string;
};

export function AppLogoMark({ className, imgClassName }: AppLogoMarkProps) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden", className)}
    >
      <img
        src={APP_LOGO_SRC}
        alt=""
        className={cn("h-full w-full object-contain", imgClassName)}
        decoding="async"
      />
    </span>
  );
}
