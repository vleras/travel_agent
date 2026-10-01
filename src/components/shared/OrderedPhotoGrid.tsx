import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface PhotoLoadingProps {
  loadEnabled: boolean;
  onSettled: () => void;
}

/** Start a new row only after every cover in the preceding row has rendered. */
export function OrderedPhotoGrid({ count, children }: {
  count: number;
  children: (photoProps: (index: number) => PhotoLoadingProps) => ReactNode;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(0);
  const [settled, setSettled] = useState<Set<number>>(() => new Set());

  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const tracks = getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean);
      setColumns(Math.max(1, tracks.length));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  let firstUnfinished = 0;
  while (firstUnfinished < count && settled.has(firstUnfinished)) firstUnfinished += 1;
  const enabledCount = columns ? Math.min(count, (Math.floor(firstUnfinished / columns) + 1) * columns) : 0;

  return <div ref={grid} className="place-pick-grid">
    {children(index => ({
      loadEnabled: index < enabledCount,
      onSettled: () => setSettled(current => current.has(index) ? current : new Set([...current, index])),
    }))}
  </div>;
}
