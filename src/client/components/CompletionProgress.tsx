export function CompletionProgress({ percentage }: { percentage?: number }) {
  if (percentage === undefined) return null;
  return (
    <span
      className="completion-progress"
      role="img"
      aria-label={`${percentage}% of descendants done`}
      title={`${percentage}% of descendants done`}
    >
      {percentage}%
    </span>
  );
}
