import {useId} from 'react';

// Sigilo HackerZ: anel quebrado, chifres e um "Z" em forma de lâmina. Desenho próprio.
export function Mark({size = 46, className = ''}) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="HackerZ">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff4358" />
          <stop offset="1" stopColor="#7a0b17" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="66" r="50" fill="none" stroke={`url(#g${id})`} strokeWidth="2.2"
        strokeDasharray="92 10 38 10 118 10" transform="rotate(-24 60 66)" />
      <path d="M33 42C21 31 20 15 29 5c1 12 10 19 22 25z" fill={`url(#g${id})`} />
      <path d="M87 42c12-11 13-27 4-37-1 12-10 19-22 25z" fill={`url(#g${id})`} />
      <path d="M32 42h56v13L56 78h32v13H32V78l32-23H32z" fill={`url(#g${id})`} />
      <path d="M54 96h12l-6 18z" fill="#ff4358" />
    </svg>
  );
}

export function Wordmark({compact = false}) {
  return (
    <span className={`wordmark${compact ? ' compact' : ''}`}>
      <b>HACKER<i>Z</i></b>
      <small>DIGITAL UNDERWORLD</small>
    </span>
  );
}
