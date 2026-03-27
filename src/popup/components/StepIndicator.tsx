interface StepIndicatorProps {
  steps: string[];
  current: number;
}

export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-1 mb-4">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-1 flex-1">
          <div
            className={`
              w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0
              ${i < current ? 'bg-status-green text-white' : ''}
              ${i === current ? 'bg-accent-purple text-white' : ''}
              ${i > current ? 'bg-midnight-500 text-gray-400' : ''}
            `}
          >
            {i < current ? '\u2713' : i + 1}
          </div>
          <span className={`text-[10px] truncate ${i === current ? 'text-white' : 'text-gray-500'}`}>
            {label}
          </span>
          {i < steps.length - 1 && (
            <div className={`h-px flex-1 ${i < current ? 'bg-status-green' : 'bg-midnight-500'}`} />
          )}
        </div>
      ))}
    </div>
  );
}
