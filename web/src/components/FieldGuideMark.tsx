/** A small geometric bee: two wings, a honey body, and three ink bands. */
export function FieldGuideMark() {
  return (
    <svg
      className="bee-mark"
      viewBox="0 0 32 36"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M15 14C4 15 2 8 6 5c5-3 9 3 9 9ZM17 14c11 1 13-6 9-9-5-3-9 3-9 9Z"
        fill="var(--surface)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="m12 9-2-5M20 9l2-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M8 18a8 8 0 0 1 16 0v6a8 8 0 0 1-16 0v-6Z"
        fill="var(--honey)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M8 18h16v3H8zM8 25h16l-1.5 3h-13L8 25Z" fill="currentColor" />
      <path d="m14 32 2 3 2-3" fill="currentColor" />
    </svg>
  );
}
