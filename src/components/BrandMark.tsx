export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      role="img"
      aria-label="LaserCut Studio"
    >
      <rect width="48" height="48" rx="12" fill="#181a1e" />
      <path
        d="M12 11h12v6H18v7h-6V11Zm19 0h5a1 1 0 0 1 1 1v12h-6v-7h-7v-6h7ZM12 24h6v7h7v6H13a1 1 0 0 1-1-1V24Z"
        fill="#f1f0ec"
      />
      <path d="M30 24h7v12a1 1 0 0 1-1 1H24v-6h7v-7Z" fill="#f07842" />
    </svg>
  )
}
