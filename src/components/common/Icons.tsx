import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function HeartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20.8 4.9a5.4 5.4 0 0 0-7.6 0L12 6.1l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.5a5.4 5.4 0 0 0 0-7.6Z" />
    </svg>
  );
}
export function UserIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8" r="3.2" fill="currentColor" stroke="none" />
      <path d="M5.5 20c.4-4 2.5-6 6.5-6s6.1 2 6.5 6" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function PowerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 2v9" />
      <path d="M6.4 5.7a8 8 0 1 0 11.2 0" />
    </svg>
  );
}
export function LiveLinkIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12.2 9.1 8.4 8a6.2 6.2 0 0 0-3.1 11.9l4.1 1.2"
        stroke="#25f4ee"
        strokeWidth="3.8"
        strokeLinecap="round"
      />
      <path
        d="m19.8 22.9 3.8 1.1a6.2 6.2 0 0 0 3.1-11.9l-4.1-1.2"
        stroke="#fe2c55"
        strokeWidth="3.8"
        strokeLinecap="round"
      />
      <path d="m10.7 19.8 10.6-7.6" stroke="white" strokeWidth="4.2" strokeLinecap="round" />
      <circle cx="10.1" cy="20.3" r="4.8" stroke="#fe2c55" strokeWidth="2.7" />
      <circle cx="21.9" cy="11.7" r="4.8" stroke="#25f4ee" strokeWidth="2.7" />
    </svg>
  );
}
export function PeopleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M2.7 20c.4-4 2.1-6 5.3-6s5 2 5.3 6M13 16c1-.9 2.2-1.3 3.7-1.3 2.8 0 4.3 1.7 4.6 5.3" />
    </svg>
  );
}
export function MoreIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}
export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m5 5 14 14M19 5 5 19" />
    </svg>
  );
}
