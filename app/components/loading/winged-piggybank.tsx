import { useId } from "react";

type WingedPiggybankProps = {
  layout?: "page" | "section";
  message?: string;
};

export function WingedPiggybank({
  layout = "section",
  message = "Preparando tu resumen...",
}: WingedPiggybankProps) {
  const gradientPrefix = useId().replaceAll(":", "");

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={`deco-loader deco-loader--${layout}`}
      role="status"
    >
      <svg
        aria-hidden="true"
        className="deco-loader__flight"
        fill="none"
        viewBox="2 18 220 136"
        xmlns="http://www.w3.org/2000/svg"
      >
        <ellipse
          className="deco-loader__shadow"
          cx="110"
          cy="145"
          fill="var(--deco-bronze)"
          opacity=".22"
          rx="48"
          ry="8"
        />
        <g className="deco-loader__pig">
          <g className="deco-loader__wing deco-loader__wing--left">
            <path
              d="M70 79c-16-23-35-18-31-5 2 7 11 9 19 9-14-5-17 2-10 8 7 6 18 2 25-5"
              fill={`url(#${gradientPrefix}-wingGold)`}
              stroke="var(--deco-bronze)"
              strokeWidth="2"
            />
            <path
              d="m49 72 11 11m-7-14 13 14"
              stroke="var(--deco-ivory)"
              strokeLinecap="round"
              strokeWidth="1.5"
            />
          </g>
          <g className="deco-loader__wing deco-loader__wing--right">
            <path
              d="M150 79c16-23 35-18 31-5-2 7-11 9-19 9 14-5 17 2 10 8-7 6-18 2-25-5"
              fill={`url(#${gradientPrefix}-wingGold)`}
              stroke="var(--deco-bronze)"
              strokeWidth="2"
            />
            <path
              d="m171 72-11 11m7-14-13 14"
              stroke="var(--deco-ivory)"
              strokeLinecap="round"
              strokeWidth="1.5"
            />
          </g>
          <path
            d="M73 66c7-16 22-25 37-25s30 9 37 25l7 34c3 16-9 29-25 29H91c-16 0-28-13-25-29l7-34Z"
            fill={`url(#${gradientPrefix}-pigCeramic)`}
            stroke="var(--deco-bronze)"
            strokeWidth="2.5"
          />
          <path
            d="m83 57-2-17c-.5-5 4-8 8-5l17 14m31 8 2-17c.5-5-4-8-8-5l-17 14"
            fill={`url(#${gradientPrefix}-pigCeramic)`}
            stroke="var(--deco-bronze)"
            strokeLinejoin="round"
            strokeWidth="2.5"
          />
          <path
            d="M96 50h28"
            stroke="var(--deco-charcoal)"
            strokeLinecap="round"
            strokeWidth="4"
          />
          <path
            d="M87 72c3-4 8-4 11 0m24 0c3-4 8-4 11 0"
            stroke="var(--deco-charcoal)"
            strokeLinecap="round"
            strokeWidth="2.5"
          />
          <ellipse
            cx="110"
            cy="91"
            fill={`url(#${gradientPrefix}-snoutGold)`}
            stroke="var(--deco-bronze)"
            strokeWidth="2"
            rx="19"
            ry="13"
          />
          <ellipse cx="104" cy="91" fill="var(--deco-charcoal)" rx="2" ry="3" />
          <ellipse cx="116" cy="91" fill="var(--deco-charcoal)" rx="2" ry="3" />
          <path
            d="M102 111c5 5 11 5 16 0"
            stroke="var(--deco-charcoal)"
            strokeLinecap="round"
            strokeWidth="2"
          />
          <path
            d="M82 119v7m17 2v5m23-5v5m17-14v7"
            stroke="var(--deco-bronze)"
            strokeLinecap="round"
            strokeWidth="4"
          />
          <path
            d="M148 103c13-4 14 8 5 10-4 1-7-1-8-4"
            stroke="var(--deco-bronze)"
            strokeLinecap="round"
            strokeWidth="3"
          />
          <path
            d="M80 104c9 5 17 7 30 7s21-2 30-7"
            stroke="var(--deco-ivory)"
            opacity=".62"
            strokeWidth="1.5"
          />
        </g>
        <defs>
          <linearGradient
            gradientUnits="userSpaceOnUse"
            id={`${gradientPrefix}-pigCeramic`}
            x1="74"
            x2="152"
            y1="47"
            y2="126"
          >
            <stop stopColor="var(--deco-ivory)" />
            <stop offset=".48" stopColor="#d7c9a5" />
            <stop offset="1" stopColor="var(--deco-bronze)" />
          </linearGradient>
          <linearGradient
            gradientUnits="userSpaceOnUse"
            id={`${gradientPrefix}-snoutGold`}
            x1="96"
            x2="124"
            y1="81"
            y2="101"
          >
            <stop stopColor="#eadbb8" />
            <stop offset="1" stopColor="var(--deco-bronze)" />
          </linearGradient>
          <linearGradient
            gradientUnits="userSpaceOnUse"
            id={`${gradientPrefix}-wingGold`}
            x1="42"
            x2="66"
            y1="67"
            y2="92"
          >
            <stop stopColor="var(--deco-ivory)" />
            <stop offset="1" stopColor="var(--deco-bronze)" />
          </linearGradient>
        </defs>
      </svg>
      <span className="deco-loader__message">{message}</span>
    </div>
  );
}
