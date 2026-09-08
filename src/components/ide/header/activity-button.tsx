import { useTranslations } from "next-intl";
import starSvg from "@/assets/star.svg";
import { useActivityStore } from "../activity-store";
import { WorkspaceNavButton } from "../workspace/nav-button";

// Vite can inline SVGs as data URLs containing spaces and parentheses.
// Quote the URL so CSS parses the entire asset as a single mask image.
const starMask = `url("${starSvg}") center / contain no-repeat`;

export function ActivityButton() {
  const t = useTranslations("activity");
  const open = useActivityStore((s) => s.open);
  const toggleOpen = useActivityStore((s) => s.toggleOpen);

  return (
    <WorkspaceNavButton
      active={open}
      aria-label={t("title")}
      aria-expanded={open}
      aria-controls="activity-panel"
      className="shrink-0"
      onClick={toggleOpen}
      title={t("title")}
    >
      <span
        aria-hidden="true"
        className="size-4 bg-current"
        style={{
          mask: starMask,
          WebkitMask: starMask,
        }}
      />
    </WorkspaceNavButton>
  );
}
