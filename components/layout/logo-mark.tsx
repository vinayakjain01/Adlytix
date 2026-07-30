import { cn } from '@/lib/utils';

/** Three ascending bars on a gradient tile. Used by the sidebar and sign-in. */
export function LogoMark({
  size = 30,
  className,
}: {
  size?: number;
  className?: string;
}) {
  // Bar geometry scales with the tile so the mark stays balanced at any size.
  const barWidth = Math.max(2, Math.round(size * 0.083));
  const gap = Math.max(2, Math.round(size * 0.083));
  const heights = [0.3, 0.467, 0.2].map((ratio) => Math.round(size * ratio));

  return (
    <div
      aria-hidden
      className={cn(
        'flex flex-shrink-0 items-center justify-center',
        'bg-[linear-gradient(140deg,#6B8BFF,#8B5CF6)]',
        'shadow-[0_6px_18px_rgb(91_124_255_/_0.3)]',
        className,
      )}
      style={{ width: size, height: size, borderRadius: size * 0.3, gap }}
    >
      {heights.map((height, i) => (
        <span
          key={i}
          className="rounded-[2px]"
          style={{
            width: barWidth,
            height,
            background: i === 2 ? 'rgb(255 255 255 / 0.6)' : 'rgb(255 255 255 / 0.95)',
          }}
        />
      ))}
    </div>
  );
}
